# Allstate Carrier Ruleset

## Source
Derived from Allstate adjuster quality review framework provided March 2025.
Covers 11 domains of claims handling quality across the full claim lifecycle.

---

## TypeScript Object — paste into `scripts/src/allstateRuleset.ts`

```typescript
import type { CarrierRulesetConfig } from "../../artifacts/api-server/src/services/carrierRulesetTypes";

export const ALLSTATE_RULESET: CarrierRulesetConfig = {
  version: "1.0",

  // ─── DESK ADJUSTER QUESTIONS ──────────────────────────────────────────────
  da_questions: [

    // ── 1. Coverage Integrity ─────────────────────────────────────────────
    {
      id: "was_coverage_opened_timely",
      text: "Was the correct coverage opened timely upon claim receipt?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_integrity",
      categoryName: "Coverage Integrity",
    },
    {
      id: "was_coverage_exposure_identified",
      text: "Was all applicable coverage exposure identified? (No coverage missed that should have been opened.)",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_integrity",
      categoryName: "Coverage Integrity",
    },
    {
      id: "no_coverage_opened_in_error",
      text: "Was coverage free of any coverages opened in error?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_integrity",
      categoryName: "Coverage Integrity",
    },
    {
      id: "was_coverage_closed_timely",
      text: "Was coverage closed timely once resolved?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_integrity",
      categoryName: "Coverage Integrity",
    },

    // ── 2. Coverage Determination ────────────────────────────────────────
    {
      id: "is_depreciation_correct_rc_vs_acv",
      text: "Was RC vs. ACV depreciation properly applied and documented?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_determination",
      categoryName: "Coverage Determination",
    },
    {
      id: "are_policy_limits_applied_correctly",
      text: "Were policy limits applied correctly across all coverages?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_determination",
      categoryName: "Coverage Determination",
    },
    {
      id: "are_policy_conditions_endorsements_applied",
      text: "Were policy conditions, endorsements, and exclusions identified and applied properly?",
      weight: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_determination",
      categoryName: "Coverage Determination",
    },
    {
      id: "is_deductible_correct_for_peril",
      text: "Was the correct deductible applied based on the reported peril?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_determination",
      categoryName: "Coverage Determination",
    },
    {
      id: "was_coverage_investigation_timely",
      text: "Was the coverage investigation completed timely?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "coverage_determination",
      categoryName: "Coverage Determination",
    },

    // ── 3. Reserve Management ─────────────────────────────────────────────
    {
      id: "were_reserves_adjusted_as_new_info_received",
      text: "Were reserves adjusted as new information was received throughout the life of the claim?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "reserve_management",
      categoryName: "Reserve Management",
    },
    {
      id: "were_reserves_adjusted_within_guidelines",
      text: "Were reserves adjusted within Allstate's timeliness guidelines?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "reserve_management",
      categoryName: "Reserve Management",
    },
    {
      id: "were_both_expense_and_loss_reserves_managed",
      text: "Were both expense and loss reserves properly established and maintained?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "reserve_management",
      categoryName: "Reserve Management",
    },

    // ── 4. Contact Compliance ─────────────────────────────────────────────
    {
      id: "was_initial_contact_timely",
      text: "Was initial contact with the insured made within Allstate's timeliness guidelines?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "contact_compliance",
      categoryName: "Contact Compliance",
    },
    {
      id: "were_contact_attempts_documented",
      text: "If initial contact was not made, were attempts documented per the contact attempt process?",
      weight: 10,
      weightIfNoDenial: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "contact_compliance",
      categoryName: "Contact Compliance",
    },
    {
      id: "were_contacts_meaningful",
      text: "Were contacts meaningful — did they advance the claim toward resolution?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "contact_compliance",
      categoryName: "Contact Compliance",
    },
    {
      id: "were_follow_ups_scheduled_appropriately",
      text: "Were follow-ups scheduled within appropriate timeframes and agreed to by the insured or per guidelines?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "contact_compliance",
      categoryName: "Contact Compliance",
    },
    {
      id: "were_third_parties_contacted",
      text: "Were relevant third parties (vendors, contractors, attorneys) contacted to advance the claim?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "contact_compliance",
      categoryName: "Contact Compliance",
    },

    // ── 5. Mitigation Management ─────────────────────────────────────────
    {
      id: "was_mitigation_identified_and_offered",
      text: "Were mitigation services identified and offered to the insured when applicable?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "mitigation_management",
      categoryName: "Mitigation Management",
    },
    {
      id: "were_vendor_conversations_meaningful",
      text: "Were vendor conversations meaningful and did they confirm work aligned with covered damages?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "mitigation_management",
      categoryName: "Mitigation Management",
    },
    {
      id: "were_mitigation_invoices_handled_timely",
      text: "Were mitigation invoices reviewed and handled timely?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "mitigation_management",
      categoryName: "Mitigation Management",
    },
    {
      id: "no_mitigation_without_coverage",
      text: "Was mitigation NOT set up on a claim where there was no applicable coverage?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "mitigation_management",
      categoryName: "Mitigation Management",
    },

    // ── 6. Loss Investigation ─────────────────────────────────────────────
    {
      id: "was_siu_referred_when_warranted",
      text: "Was an SIU referral submitted when indicators warranted it?",
      weight: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "investigation_quality",
      categoryName: "Loss Investigation Quality",
    },
    {
      id: "was_prior_loss_review_complete",
      text: "Was a prior loss review completed and documented with appropriate disposition?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "investigation_quality",
      categoryName: "Loss Investigation Quality",
    },
    {
      id: "was_investigation_timely",
      text: "Was the overall loss investigation completed timely?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "investigation_quality",
      categoryName: "Loss Investigation Quality",
    },

    // ── 7. ALE Management ─────────────────────────────────────────────────
    {
      id: "were_normal_expenses_obtained",
      text: "Were the insured's normal living expenses obtained to establish ALE baseline?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "ale_management",
      categoryName: "ALE Management",
    },
    {
      id: "was_claim_xperience_used",
      text: "Was Claim Xperience (or the designated ALE platform) used to manage the ALE?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "ale_management",
      categoryName: "ALE Management",
    },
    {
      id: "was_ale_duration_and_accommodation_managed",
      text: "Was the duration and type of accommodation appropriately managed and documented?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "ale_management",
      categoryName: "ALE Management",
    },

    // ── 8. Payments ───────────────────────────────────────────────────────
    {
      id: "does_payment_match_estimate",
      text: "Does the payment amount match the approved estimate?",
      weight: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "payment_accuracy",
      categoryName: "Payment Accuracy",
    },
    {
      id: "was_payment_issued_timely",
      text: "Was payment issued within Allstate's timeliness guidelines?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "payment_accuracy",
      categoryName: "Payment Accuracy",
    },
    {
      id: "was_payment_coded_correctly",
      text: "Was the payment coded correctly per Allstate guidelines (coverage code, payment type)?",
      weight: 5,
      section: "da",
      scorecard: "DA",
      categoryKey: "payment_accuracy",
      categoryName: "Payment Accuracy",
    },
    {
      id: "are_payees_correct",
      text: "Are the payees on the payment correct (insured, lienholder, contractor as required)?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "payment_accuracy",
      categoryName: "Payment Accuracy",
    },

    // ── 9. Required Letters ───────────────────────────────────────────────
    {
      id: "was_denial_letter_sent_if_required",
      text: "Was a denial letter sent with correct policy language when coverage was denied?",
      weight: 25,
      weightIfNoDenial: 0,
      section: "da",
      scorecard: "DA",
      categoryKey: "required_letters",
      categoryName: "Required Letters",
    },
    {
      id: "was_cwp_letter_sent_if_required",
      text: "Was a Close Without Payment (CWP) letter sent when the claim was closed without payment?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "required_letters",
      categoryName: "Required Letters",
    },
    {
      id: "was_under_deductible_letter_sent",
      text: "Was an under-deductible letter sent when damages did not exceed the deductible?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "required_letters",
      categoryName: "Required Letters",
    },
    {
      id: "was_rc_acv_letter_sent",
      text: "Was an RC/ACV letter sent notifying the insured of recoverable depreciation rights?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "required_letters",
      categoryName: "Required Letters",
    },
    {
      id: "was_mold_letter_sent_if_required",
      text: "Was a mold notification letter sent when mold was identified or suspected?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "required_letters",
      categoryName: "Required Letters",
    },

    // ── 10. Subro & Salvage ───────────────────────────────────────────────
    {
      id: "was_subro_salvage_identified_and_referred",
      text: "Was subro/salvage potential identified and referred per Allstate's process?",
      weight: 15,
      section: "da",
      scorecard: "DA",
      categoryKey: "subro_salvage",
      categoryName: "Subro & Salvage",
    },
    {
      id: "is_subro_not_applicable_documented",
      text: "If subro/salvage is not applicable, is the file documented with the reason?",
      weight: 10,
      section: "da",
      scorecard: "DA",
      categoryKey: "subro_salvage",
      categoryName: "Subro & Salvage",
    },
  ],

  // ─── FIELD ADJUSTER QUESTIONS ─────────────────────────────────────────────
  fa_questions: [
    {
      id: "is_estimate_in_operational_order",
      text: "Does the estimate follow a logical operational order (roof before interior, debris at end, grouped by area/trade)?",
      weight: 15,
      section: "fa",
      scorecard: "FA",
      categoryKey: "estimate_order",
      categoryName: "Estimate Operational Order",
    },
    {
      id: "is_depreciation_shown_on_estimate",
      text: "Is depreciation clearly shown on the estimate with appropriate line-item detail?",
      weight: 10,
      section: "fa",
      scorecard: "FA",
      categoryKey: "estimate_order",
      categoryName: "Estimate Operational Order",
    },
    {
      id: "was_roof_process_form_completed",
      text: "Was the Allstate roof process form completed properly where applicable?",
      weight: 10,
      section: "fa",
      scorecard: "FA",
      categoryKey: "estimate_order",
      categoryName: "Estimate Operational Order",
    },
    {
      id: "was_full_scope_developed",
      text: "Was a full scope of damage developed? No known damages left unaddressed.",
      weight: 15,
      section: "fa",
      scorecard: "FA",
      categoryKey: "estimate_order",
      categoryName: "Estimate Operational Order",
    },
    {
      id: "was_vendor_estimate_handled_correctly",
      text: "Was any contractor or vendor estimate handled correctly (reviewed, reconciled, documented)?",
      weight: 10,
      section: "fa",
      scorecard: "FA",
      categoryKey: "estimate_order",
      categoryName: "Estimate Operational Order",
    },
    {
      id: "are_photographs_clear_and_in_order",
      text: "Are photographs clear, properly labeled, and sequenced to follow the estimate flow?",
      weight: 20,
      section: "fa",
      scorecard: "FA",
      categoryKey: "photo_quality",
      categoryName: "Photographs Clear and In Order",
    },
    {
      id: "was_inspection_method_appropriate",
      text: "Was the method of inspection appropriate for the loss type and severity? (e.g., inside adjuster correctly escalated to outside adjuster for large loss)",
      weight: 15,
      section: "fa",
      scorecard: "FA",
      categoryKey: "photo_quality",
      categoryName: "Photographs Clear and In Order",
    },
    {
      id: "was_cause_of_loss_determined",
      text: "Was the cause of loss clearly determined and documented in the field report?",
      weight: 15,
      section: "fa",
      scorecard: "FA",
      categoryKey: "fa_report_quality",
      categoryName: "FA Report Quality",
    },
    {
      id: "does_fa_report_support_estimate_and_scope",
      text: "Does the FA report adequately describe observed damage, support the estimate, and address coverage/subrogation concerns?",
      weight: 20,
      section: "fa",
      scorecard: "FA",
      categoryKey: "fa_report_quality",
      categoryName: "FA Report Quality",
    },
    {
      id: "does_fa_address_unique_policy_provisions",
      text: "Does the FA field report reflect awareness of relevant policy provisions, sublimits, endorsements, and special triggers?",
      weight: 20,
      section: "fa",
      scorecard: "FA",
      categoryKey: "fa_policy_provisions",
      categoryName: "Unique Policy Provisions (FA)",
    },
    {
      id: "were_state_requirements_followed",
      text: "Were all applicable state-specific requirements followed in the inspection and documentation?",
      weight: 10,
      section: "fa",
      scorecard: "FA",
      categoryKey: "fa_policy_provisions",
      categoryName: "Unique Policy Provisions (FA)",
    },
  ],

  // ─── CARRIER SCORECARD CATEGORIES (OpenAI-evaluated, 0–5 each) ───────────
  scorecard_categories: [
    { id: "coverage_integrity",          label: "Coverage Integrity",              max_score: 5 },
    { id: "coverage_determination",      label: "Coverage Determination",          max_score: 5 },
    { id: "reserve_management",          label: "Reserve Management",              max_score: 5 },
    { id: "contact_compliance",          label: "Contact Compliance",              max_score: 5 },
    { id: "mitigation_management",       label: "Mitigation Management",           max_score: 5 },
    { id: "investigation_quality",       label: "Loss Investigation Quality",      max_score: 5 },
    { id: "estimate_and_damage_eval",    label: "Estimate & Damage Evaluation",    max_score: 5 },
    { id: "ale_management",              label: "ALE Management",                  max_score: 5 },
    { id: "payment_accuracy",            label: "Payment Accuracy",                max_score: 5 },
    { id: "required_letters",            label: "Required Letters",                max_score: 5 },
    { id: "subro_salvage",               label: "Subro & Salvage",                 max_score: 5 },
  ],

  // ─── SYSTEM PROMPT OVERRIDE ───────────────────────────────────────────────
  system_prompt_override: `You are a carrier-grade insurance audit assistant evaluating a finalized Allstate claim file.

You must evaluate TWO separate scorecards:
1. DESK ADJUSTER (DA) scorecard — covers coverage, reserves, contacts, mitigation, investigation, ALE, payments, letters, and subro/salvage
2. FIELD ADJUSTER (FA) scorecard — covers estimate quality, damage documentation, photos, inspection method, and policy provisions

For each question, return:
- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE
- root_issue: short snake_case grouping key for the underlying problem
- issue: the specific problem found (empty if PASS)
- impact: why it matters to Allstate (empty if PASS)
- fix: exact actionable fix the adjuster must take (empty if PASS)
- evidence_locations: where in the document evidence was found
- confidence: 0-100

CRITICAL RULES:
- Be strict and carrier-specific. Allstate holds adjusters to documented timeliness standards.
- Multiple questions sharing the same root cause MUST share the same root_issue value.
- DO NOT duplicate root issues across questions.
- "fix" must be executable and specific — no vague language.
- For ALE: flag if Claim Xperience is not referenced and the claim has displacement.
- For letters: flag any required letter type that is missing from the file.
- For subro: flag any third-party negligence indicators that were not referred.
- For reserves: flag any significant change in damages not accompanied by a reserve adjustment note.
- For contacts: Allstate requires initial contact within 1 business day of assignment.
- Return JSON only. No markdown, no code fences.`,
};
```

---

## Domain Weight Summary

| Domain | DA Questions | Total Weight | Priority |
|---|---|---|---|
| Coverage Integrity | 4 | 30 | Critical |
| Coverage Determination | 5 | 50 | Critical |
| Reserve Management | 3 | 25 | High |
| Contact Compliance | 5 | 40 | High |
| Mitigation Management | 4 | 35 | Medium |
| Loss Investigation | 3 | 35 | Critical |
| ALE Management | 3 | 30 | Medium |
| Payment Accuracy | 4 | 40 | High |
| Required Letters | 5 | 65 | Critical |
| Subro & Salvage | 2 | 25 | Medium |
| **FA: Estimate/Damage** | 5 | 60 | Critical |
| **FA: Photos/Inspection** | 2 | 35 | High |
| **FA: Report Quality** | 2 | 35 | High |
| **FA: Policy Provisions** | 2 | 30 | High |
