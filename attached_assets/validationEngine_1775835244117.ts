export interface ValidationIssue {
  key: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface ValidationResult {
  checks: ValidationIssue[];
  ready: boolean;
}

function extractPaymentAmounts(text: string): string[] {
  const matches = text.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
  return matches.map((m) => m.replace(/[$,]/g, ""));
}

/**
 * Detects whether the DA report explicitly states no payment is recommended.
 * When true, payment letter and SOL flags should be suppressed — there is
 * nothing to reconcile if the carrier owes $0.
 */
export function detectNoPaymentRecommended(reportText: string): boolean {
  return /no payment (is )?(recommended|warranted|owed|due)|payment.*not recommended|recommend(s|ed)?\s+no\s+payment|\$0\.?00?\s+(recommended|payment)|zero[- ]dollar|no[- ]payment[- ]recommendation/i.test(reportText);
}

export function detectPaymentMismatch(text: string): boolean {
  // If DA explicitly says no payment recommended, suppress mismatch detection
  if (detectNoPaymentRecommended(text)) return false;

  const sections = {
    daReport: "",
    sol: "",
    paymentLetter: "",
  };

  const lower = text.toLowerCase();
  const daIdx = lower.indexOf("desk adjuster") !== -1 ? lower.indexOf("desk adjuster") : lower.indexOf("da report");
  const solIdx = lower.indexOf("statement of loss") !== -1 ? lower.indexOf("statement of loss") : lower.indexOf("sol");
  const payIdx = lower.indexOf("payment letter") !== -1 ? lower.indexOf("payment letter") : lower.indexOf("payment recommendation");

  const indices = [
    { key: "daReport" as const, idx: daIdx },
    { key: "sol" as const, idx: solIdx },
    { key: "paymentLetter" as const, idx: payIdx },
  ].filter((x) => x.idx !== -1).sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].idx;
    const end = i + 1 < indices.length ? indices[i + 1].idx : text.length;
    sections[indices[i].key] = text.slice(start, Math.min(start + 3000, end));
  }

  const sectionAmounts: string[][] = [];
  for (const section of Object.values(sections)) {
    if (section) {
      sectionAmounts.push(extractPaymentAmounts(section));
    }
  }

  if (sectionAmounts.length < 2) {
    const allAmounts = extractPaymentAmounts(text);
    const relevant = allAmounts.slice(0, 8);
    const unique = new Set(relevant);
    return unique.size > 3;
  }

  const allSets = sectionAmounts.map((a) => new Set(a));
  for (let i = 0; i < allSets.length; i++) {
    for (let j = i + 1; j < allSets.length; j++) {
      const intersection = [...allSets[i]].filter((v) => allSets[j].has(v));
      if (intersection.length === 0 && allSets[i].size > 0 && allSets[j].size > 0) {
        return true;
      }
    }
  }

  return false;
}

// FIX: Use case-insensitive regex patterns instead of exact strings.
// Require at least 5 of 7 markers found in sequence to reduce false positives
// from OCR text variations or missing optional sections (e.g., sketch).
export function validateStackOrder(documentPages: string[]): boolean {
  const expectedPatterns = [
    /desk adjuster|da report/i,
    /statement of loss|sol\b/i,
    /payment letter|payment recommendation|dear\s+\w/i,
    /estimate|xactimate/i,
    /photo sheet|photograph|photos/i,
    /sketch|diagram|floor plan/i,
    /iso file number|iso claimsearch|clue report|prior loss report/i,
  ];

  let currentIndex = 0;

  for (const page of documentPages) {
    if (currentIndex >= expectedPatterns.length) break;
    if (expectedPatterns[currentIndex].test(page)) {
      currentIndex++;
    }
  }

  // Require at least 5 of 7 markers found in correct order.
  // Tolerates optional sections (sketch, Other Letters) without false-positive flagging.
  return currentIndex >= 5;
}

// FIX: Broadened regex to catch more natural-language acknowledgments of prior losses.
// If no ISO report is present, prior loss review is not applicable — return true (valid).
// Added "no related" to accept DA statements that priors exist but are unrelated.
export function validatePriorLossReview(daReportText: string, hasIsoReport: boolean): boolean {
  if (!hasIsoReport) return true;
  return /prior loss|prior claims|iso|clue|not relevant|no prior|no relevant|reviewed.*prior|prior.*review|no related|unrelated|none within|no losses within/i.test(daReportText);
}

/**
 * Detects visual water damage evidence from photo captions and report narrative.
 * Used as an alternative validation path when moisture meter readings are absent.
 * Looks for language indicating visible discoloration, staining, or water damage
 * that would visually confirm the presence of water intrusion.
 */
export function detectVisualWaterEvidence(reportText: string): boolean {
  // Look for adjuster-written captions or narrative describing visible water damage
  return /water.{0,30}(stain|damage|ceiling|wall|floor|discolor|saturate|soak|wet|leak|ice dam)/i.test(reportText)
    || /discolor|stain|dark.{0,20}(ceiling|wall|floor)|bubble|blister|sag/i.test(reportText)
    || /ice dam|ice.{0,10}dam/i.test(reportText)
    || /(ceiling|wall|floor).{0,30}(damaged|saturated|affected|wet).{0,30}(water|moisture|leak|ice)/i.test(reportText);
}

/**
 * Detects whether a mitigation vendor is referenced in the file.
 * If a mit vendor is present, the FA should NOT be estimating mitigation items.
 */
export function detectMitigationVendor(reportText: string): boolean {
  return /mitigation (vendor|company|contractor|team)|water (remediation|mitigation|restoration)|ServPro|ServiceMaster|BELFOR|Paul Davis|mit vendor|mit team/i.test(reportText);
}

/**
 * Detects whether the file states that the insured has NOT engaged mitigation.
 * This is a valid justification for the absence of mitigation documentation —
 * if mitigation was never performed, there is nothing to photograph or document.
 */
export function detectMitigationNotEngaged(reportText: string): boolean {
  return /insured has not engaged|no mitigation (was )?(performed|engaged|initiated|completed)|mitigation not (engaged|performed|initiated)|declined mitigation|did not engage mitigation|no mit(igation)?\s+(has been|was)\s+(performed|done|completed)/i.test(reportText);
}

export function runValidation(reportText: string): ValidationResult {
  const checks: ValidationIssue[] = [];

  if (detectPaymentMismatch(reportText)) {
    checks.push({
      key: "payment_inconsistency",
      severity: "warning",
      message: "Possible mismatch between DA, SOL, and payment letter values",
    });
  }

  const deductibleMatches = reportText.match(/deductible[^.]*?\$[\d,]+(?:\.\d{2})?/gi) || [];
  const dedValues = deductibleMatches.map((m) => {
    const v = m.match(/\$([\d,]+(?:\.\d{2})?)/);
    return v ? v[1].replace(/,/g, "") : "";
  }).filter(Boolean);
  if (new Set(dedValues).size > 1) {
    checks.push({
      key: "deductible_inconsistency",
      severity: "critical",
      message: "Deductible values appear inconsistent across documents — verify correct application",
    });
  }

  if (/deferred|pending/i.test(reportText)) {
    if (!/next step|follow.?up|will be|to be/i.test(reportText)) {
      checks.push({
        key: "deferred_missing_next_step",
        severity: "warning",
        message: "Deferred item detected without a documented next step",
      });
    }
  }

  // FIX: Prior loss check now accepts "no related" and "none within" as valid dispositions.
  // The DA acknowledging priors exist but are unrelated satisfies the review requirement.
  if (/prior loss|ISO|clue report/i.test(reportText)) {
    if (!/not relevant|no prior|reviewed|addressed|investigated|no related|unrelated|none within|no losses within/i.test(reportText)) {
      checks.push({
        key: "prior_loss_not_treated",
        severity: "warning",
        message: "Prior loss references found but treatment/disposition not documented",
      });
    }
  }

  if (/endorsement|sublimit|rider|HO.?6|HSB|municipal lien/i.test(reportText)) {
    if (!/addressed|applied|noted|accounted|considered/i.test(reportText)) {
      checks.push({
        key: "endorsement_not_addressed",
        severity: "warning",
        message: "Relevant endorsement or sublimit detected but may not be fully addressed",
      });
    }
  }

  if (/deni(al|ed)/i.test(reportText)) {
    if (/wear and tear|surface water|flood/i.test(reportText)) {
      if (/flood.*wear|wear.*flood|surface.*wear/i.test(reportText)) {
        checks.push({
          key: "denial_language_inconsistent",
          severity: "warning",
          message: "Denial language may cite inconsistent exclusion rationale — verify causation matches cited exclusion",
        });
      }
    }
  }

  // FIX: Multi-strategy page splitting to handle different OCR output formats.
  let pages = reportText.split(/={3,}\s*Page\s+\d+\s*={3,}/i).filter(Boolean);
  if (pages.length <= 1) {
    pages = reportText.split(/\f|---\s*page\s*\d+\s*---|page\s+\d+\s+of\s+\d+/i).filter(Boolean);
  }
  if (pages.length <= 1) {
    const chunkSize = 3000;
    pages = [];
    for (let i = 0; i < reportText.length; i += chunkSize) {
      pages.push(reportText.slice(i, i + chunkSize));
    }
  }
  if (pages.length > 1 && !validateStackOrder(pages)) {
    checks.push({
      key: "invalid_stack_order",
      severity: "warning",
      message: "File stack is out of order. Must be: DA Report → SOL → Payment Letter → Letters → Estimate → Photos → Sketch → Prior Loss.",
    });
  }

  // FIX: Changed severity from "critical" to "warning".
  // The AI scorecard evaluates prior losses with full context and nuance.
  // This regex check is a lightweight pre-scan only — it should warn, not block readiness.
  const lower = reportText.toLowerCase();
  const daStart = lower.indexOf("desk adjuster");
  const daEnd = lower.indexOf("statement of loss", daStart > -1 ? daStart : 0);
  const daReportText = daStart > -1 ? reportText.slice(daStart, daEnd > daStart ? daEnd : Math.min(daStart + 5000, reportText.length)) : "";
  const hasIsoReport = /ISO File Number|ISO ClaimSearch|clue report/i.test(reportText);
  if (!validatePriorLossReview(daReportText, hasIsoReport)) {
    checks.push({
      key: "missing_prior_loss_review",
      severity: "warning", // was "critical" — downgraded so it does not drive NOT READY
      message: "ISO ClaimSearch report is missing or Desk Adjuster failed to mention reviewing prior losses within the past 5 years.",
    });
  }

  if (!/cause of loss|col\b/i.test(reportText)) {
    checks.push({
      key: "missing_cause_of_loss",
      severity: "info",
      message: "Cause of loss statement may be missing from the file",
    });
  }

  if (/estimate/i.test(reportText)) {
    const hasLogicalOrder = /roof|exterior|interior|floor|wall|ceiling|debris/i.test(reportText);
    if (!hasLogicalOrder) {
      checks.push({
        key: "estimate_order_unclear",
        severity: "info",
        message: "Estimate operational order could not be verified from text",
      });
    }
  }

  if (/photo/i.test(reportText)) {
    if (!/label|caption|room|area/i.test(reportText)) {
      checks.push({
        key: "photos_may_lack_support",
        severity: "info",
        message: "Photos may not be clearly labeled or may not sufficiently support estimate scope",
      });
    }
  }

  if (/field.*report|FA.*report/i.test(reportText) && /estimate/i.test(reportText)) {
    if (/inconsisten|mismatch|contradict|does not align/i.test(reportText)) {
      checks.push({
        key: "fa_estimate_mismatch",
        severity: "warning",
        message: "Potential mismatch detected between FA narrative and estimate scope",
      });
    }
  }

  // FIX: Suppress SOL-related flags when no payment is recommended.
  // SOL is standard on every report, but only flag when payment was recommended and SOL is missing.
  if (!detectNoPaymentRecommended(reportText)) {
    if (/payment/i.test(reportText) && !/statement of loss|sol\b/i.test(reportText)) {
      checks.push({
        key: "missing_sol_with_payment",
        severity: "warning",
        message: "Payment appears recommended but Statement of Loss may be missing from the file",
      });
    }
  }

  const hasCritical = checks.some((c) => c.severity === "critical");
  return { checks, ready: !hasCritical };
}

export function runVisionValidation(
  reportText: string,
  visionResults: { tool_readings: any[]; damage_verifications: any[]; photo_sequence_valid: boolean; sequence_issues: string[] },
): ValidationIssue[] {
  const visionChecks: ValidationIssue[] = [];

  const claimsWaterMitigation = /tear.?out|drywall.*remov|dehumidifier|air mover|water mitigation|dry.?out|moisture.*content/i.test(reportText);

  if (claimsWaterMitigation) {
    const hasMoistureReading = visionResults.tool_readings.some(
      (r: any) => r.tool_type === "moisture_meter",
    );
    const hasThermalReading = visionResults.tool_readings.some(
      (r: any) => r.tool_type === "thermal_imager",
    );

    // FIX: Before flagging missing tool readings, check for visual water damage evidence.
    // If photo captions or narrative describe visible water damage (staining, discoloration,
    // ice dam damage, saturated materials), treat this as adequate visual confirmation.
    // Only escalate to a warning if there is no tool reading AND no visual evidence at all.
    const hasVisualWaterEvidence = detectVisualWaterEvidence(reportText);

    // FIX: Also check whether a mitigation vendor is involved. If so, moisture
    // documentation belongs to the vendor's scope — do not flag the FA estimate.
    const hasMitigationVendor = detectMitigationVendor(reportText);

    // FIX: Check whether the insured never engaged mitigation. If so, mitigation
    // documentation is not expected — there is nothing to document.
    const mitigationNotEngaged = detectMitigationNotEngaged(reportText);

    if (!hasMoistureReading && !hasThermalReading) {
      if (mitigationNotEngaged) {
        // Insured never engaged mitigation — documentation not applicable
        visionChecks.push({
          key: "mitigation_not_engaged",
          severity: "info",
          message: "Water mitigation scope referenced but insured has not engaged mitigation services. Mitigation documentation is not applicable.",
        });
      } else if (hasMitigationVendor) {
        // Mitigation vendor handles moisture documentation — not the FA
        visionChecks.push({
          key: "mitigation_vendor_handles_moisture",
          severity: "info",
          message: "Water mitigation scope present. Mitigation vendor is referenced — moisture meter readings are the vendor's responsibility, not the FA estimate.",
        });
      } else if (hasVisualWaterEvidence) {
        // Visual evidence of water damage found in photo captions/narrative — downgrade to info
        visionChecks.push({
          key: "visual_water_evidence_only",
          severity: "info",
          message: "Estimate includes water mitigation scope. No moisture meter readings found in photos, but photo captions or narrative describe visible water damage (staining, discoloration, or ice dam damage). Consider adding moisture readings for stronger documentation.",
        });
      } else {
        // No tool readings and no visual evidence — warn but do not block readiness
        visionChecks.push({
          key: "unverified_diagnostic_proof",
          severity: "warning", // was "critical" — downgraded; visual evidence check is now the primary gate
          message: "Estimate claims water mitigation scope but no moisture meter readings, thermal imager readings, or clear visual water damage evidence was found in the photo sheet. Verify water damage documentation.",
        });
      }
    } else if (!hasMoistureReading && !hasMitigationVendor && !mitigationNotEngaged) {
      visionChecks.push({
        key: "missing_moisture_reading",
        severity: "warning",
        message: "No moisture meter readings (e.g., Tramex) found in photos despite water mitigation scope in estimate.",
      });
    }
  }

  const discrepancies = visionResults.damage_verifications.filter(
    (d: any) => !d.damage_visible && d.confidence >= 70 && d.caption_claim && d.caption_claim.trim() !== "",
  );
  if (discrepancies.length > 0) {
    for (const d of discrepancies) {
      visionChecks.push({
        key: "caption_damage_mismatch",
        severity: "warning",
        message: `Photo caption claims "${d.caption_claim}" but Vision AI could not verify this damage is visible (${d.discrepancy || "damage not apparent in image"}).`,
      });
    }
  }

  if (!visionResults.photo_sequence_valid) {
    for (const issue of visionResults.sequence_issues) {
      visionChecks.push({
        key: "photo_sequence_error",
        severity: "warning",
        message: issue,
      });
    }
  }

  return visionChecks;
}
