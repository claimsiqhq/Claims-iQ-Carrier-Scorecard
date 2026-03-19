export interface ValidationIssue {
  type: string;
  message: string;
}

export interface ValidationResult {
  critical: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  ready: boolean;
}

export function runValidation(reportText: string): ValidationResult {
  const issues: ValidationResult = {
    critical: [],
    warnings: [],
    info: [],
    ready: true,
  };

  const payments = reportText.match(/\$[\d,]+/g) || [];
  if (new Set(payments).size > 3) {
    issues.warnings.push({
      type: "payment_variance",
      message: "Multiple payment values detected — verify consistency across documents",
    });
  }

  if (/deferred|pending/i.test(reportText)) {
    if (!/next step|follow.?up/i.test(reportText)) {
      issues.warnings.push({
        type: "deferred_missing_next_step",
        message: "Deferred item detected without a documented next step",
      });
    }
  }

  if (!/cause of loss|col\b/i.test(reportText)) {
    issues.warnings.push({
      type: "missing_cause_of_loss",
      message: "Cause of loss statement may be missing from the file",
    });
  }

  if (!/deductible/i.test(reportText)) {
    issues.info.push({
      type: "deductible_not_mentioned",
      message: "Deductible not explicitly referenced in the document text",
    });
  }

  issues.ready = issues.critical.length === 0;

  return issues;
}
