export interface ValidationIssue {
  key: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export interface ValidationResult {
  checks: ValidationIssue[];
  ready: boolean;
}

export function runValidation(reportText: string): ValidationResult {
  const checks: ValidationIssue[] = [];

  const payments = reportText.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
  if (new Set(payments).size > 3) {
    checks.push({
      key: "payment_variance",
      severity: "warning",
      message: "Multiple distinct payment values detected — verify consistency across DA report, SOL, and Payment Letter",
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
      severity: "warning",
      message: "Deductible values appear inconsistent across documents",
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
