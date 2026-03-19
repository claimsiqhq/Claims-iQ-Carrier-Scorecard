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

export function detectPaymentMismatch(text: string): boolean {
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

export function validateStackOrder(documentPages: string[]): boolean {
  const expectedOrder = [
    "Desk Adjuster Report",
    "STATEMENT OF LOSS",
    "Dear",
    "Estimate",
    "Photo Sheet",
    "Sketch",
    "ISO File Number",
  ];

  let currentIndex = 0;

  for (const page of documentPages) {
    if (currentIndex >= expectedOrder.length) break;
    if (page.includes(expectedOrder[currentIndex])) {
      currentIndex++;
    }
  }

  return currentIndex === expectedOrder.length;
}

export function validatePriorLossReview(daReportText: string, hasIsoReport: boolean): boolean {
  const mentionsPriors = /prior loss|prior claims|iso/i.test(daReportText);
  return mentionsPriors && hasIsoReport;
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

  if (/prior loss|ISO|clue report/i.test(reportText)) {
    if (!/not relevant|no prior|reviewed|addressed|investigated/i.test(reportText)) {
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

  const pages = reportText.split(/={3,}\s*Page\s+\d+\s*={3,}/i).filter(Boolean);
  if (pages.length > 1 && !validateStackOrder(pages)) {
    checks.push({
      key: "invalid_stack_order",
      severity: "warning",
      message: "File stack is out of order. Must be: DA Report → SOL → Payment Letter → Letters → Estimate → Photos → Sketch → Prior Loss.",
    });
  }

  const lower = reportText.toLowerCase();
  const daStart = lower.indexOf("desk adjuster");
  const daEnd = lower.indexOf("statement of loss", daStart > -1 ? daStart : 0);
  const daReportText = daStart > -1 ? reportText.slice(daStart, daEnd > daStart ? daEnd : Math.min(daStart + 5000, reportText.length)) : "";
  const hasIsoReport = /ISO File Number|ISO ClaimSearch|clue report/i.test(reportText);
  if (!validatePriorLossReview(daReportText, hasIsoReport)) {
    checks.push({
      key: "missing_prior_loss_review",
      severity: "critical",
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

  const hasCritical = checks.some((c) => c.severity === "critical");
  return { checks, ready: !hasCritical };
}
