-- Assurant tenant creation and Andover 2.0 ruleset realignment.
--
-- Runs after 20260904160000_purge_allstate_wawanesa_tenants.sql. The file is
-- idempotent: re-running it against an already-migrated database changes
-- nothing but still executes every preflight and final assertion.
--
-- What it does
--   1. Creates the Assurant tenant: organization
--      a11a0000-0000-4000-8000-000000000004 (slug `assurant`), its
--      organization_settings row, its carrier profile (carrier_key `assurant`),
--      its primary carrier entity, and the published Assurant ruleset 1.0.
--   2. Archives the published Andover version 1 (label 1.3 in production) and
--      publishes Andover version 2 (label 2.0), which realigns the FA categories
--      to the generic scorecard weights 30 / 15 / 25 / 30 and adds the four
--      generic checks Andover lacked (no duplicate line items, O&P applied
--      correctly, FA report clarity/grammar, carrier estimating-guideline
--      compliance). All DA checks and weights, the display name, the logo, and
--      the system prompt are unchanged. The Andover carrier profile is updated
--      to the published 2.0 ruleset.
--
-- Why direct INSERTs instead of the private.platform_* functions
--   private.platform_upsert_carrier_profile,
--   private.platform_create_carrier_ruleset_version, and
--   private.platform_publish_carrier_ruleset_version refuse to run unless
--   private.is_platform_admin_session() is true, which requires a live
--   public.sessions row matching app.user_id/app.session_id, and they record
--   platform_audit_events rows keyed by that session. A migration has no
--   session; fabricating one would forge audit provenance. This file therefore
--   writes exactly the rows those functions would write, directly, and records
--   the platform administrator as created_by/approved_by when that account
--   exists in the target database. The deferred profile-bundle constraint
--   triggers (exactly one profile and one primary entity per configured
--   organization) are satisfied because the profile and entity are inserted in
--   this single transaction.
--
-- Ruleset JSON
--   The two ruleset literals are the verbatim output of
--     pnpm --filter @workspace/scripts run ruleset:json assurant
--     pnpm --filter @workspace/scripts run ruleset:json andover
--   generated from scripts/src/assurantRuleset.ts and
--   scripts/src/andoverRuleset.ts. Never edit them by hand:
--   artifacts/api-server/src/migrations/assurantTenantRulesets.test.ts parses
--   them back out of this file and fails when they drift from the TypeScript.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- Approved inventory. Identifiers are deterministic so reruns and rehearsals
-- converge on the same rows.
CREATE TEMP TABLE assurant_realignment_rulesets (
  carrier_key text PRIMARY KEY,
  version_label text NOT NULL,
  ruleset jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO assurant_realignment_rulesets (carrier_key, version_label, ruleset)
VALUES
  (
    'assurant',
    '1.0',
    $assurant_ruleset$
    {
      "version": "1.0",
      "da_questions": [
        {
          "id": "is_file_stack_order_correct",
          "text": "Is the file stack in the correct logical order (DA report, SOL, Payment Letter, Other Letters, Estimate, Photos, Sketch, Prior Loss)?",
          "weight": 10,
          "weightIfNoDenial": 15,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "file_stack_order",
          "categoryName": "File Stack Order"
        },
        {
          "id": "do_payment_values_match",
          "text": "Do payment figures on the DA report, SOL, and Payment Letter all agree?",
          "weight": 15,
          "weightIfNoDenial": 20,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "payment_recommendations",
          "categoryName": "Payment Recommendations Match"
        },
        {
          "id": "is_deductible_correct",
          "text": "Is the deductible correctly applied across all documents?",
          "weight": 5,
          "weightIfNoDenial": 5,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "payment_recommendations",
          "categoryName": "Payment Recommendations Match"
        },
        {
          "id": "is_da_report_concise_and_decisive",
          "text": "Is the DA report concise, recommendation-focused, and not copy-paste heavy from the FA report?",
          "weight": 10,
          "weightIfNoDenial": 15,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_report_quality",
          "categoryName": "DA Report Quality"
        },
        {
          "id": "are_unique_policy_provisions_addressed",
          "text": "Are unique policy provisions (HO6, sublimits, endorsements, HSB items, municipal lien, exclusions) addressed where relevant?",
          "weight": 25,
          "weightIfNoDenial": 30,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "policy_provisions",
          "categoryName": "Unique Policy Provisions Addressed"
        },
        {
          "id": "are_prior_losses_addressed",
          "text": "Are prior losses reviewed with disposition stated (not relevant or requires investigation)?",
          "weight": 10,
          "weightIfNoDenial": 15,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "prior_losses",
          "categoryName": "Prior Losses Addressed"
        },
        {
          "id": "is_denial_letter_correct",
          "text": "If a denial letter is applicable, does it cite the correct policy language and reason?",
          "weight": 25,
          "weightIfNoDenial": 0,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "denial_letters",
          "categoryName": "Denial Letters Correct"
        }
      ],
      "fa_questions": [
        {
          "id": "fa_estimate_floors_walls_ceilings_accessories_order",
          "text": "Does the estimate follow a consistent operational order within each room or area: floors, then walls, then ceilings, with accessories (trim, fixtures, hardware) listed after the surfaces they attach to?",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order and Quality",
          "applicability": "Evaluate only areas that were inspected and scoped. Score NOT_APPLICABLE if the estimate contains no interior room scope.",
          "severity": "medium",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order"
        },
        {
          "id": "fa_estimate_roof_before_interior",
          "text": "Is exterior and roof scope placed before interior scope in the estimate?",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order and Quality",
          "applicability": "Score NOT_APPLICABLE when the claim has no roof or exterior scope, or when the narrative explains the roof was not inspected and no covered roof damage was identified.",
          "severity": "medium",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order"
        },
        {
          "id": "fa_estimate_debris_removal_last",
          "text": "Is debris removal (including dumpster and haul-off line items) listed at the end of the estimate rather than interleaved with repair scope?",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order and Quality",
          "applicability": "Score NOT_APPLICABLE if the estimate has no debris removal line items.",
          "severity": "low",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order"
        },
        {
          "id": "fa_estimate_line_items_justified",
          "text": "Is every material line item in the estimate justified by the photographs and/or the FA narrative? Score PARTIAL only if specific line items have no support in either the photos or the narrative. Consequential items (anti-microbial treatment, insulation, demolition, debris removal) are implied when the parent damage is documented.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order and Quality",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order"
        },
        {
          "id": "fa_estimate_no_duplicate_line_items",
          "text": "Is the estimate free of duplicate line items: the same repair, material, or labor billed more than once for the same area, or an item that is already included in a bundled or component line?",
          "weight": 5,
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order and Quality"
        },
        {
          "id": "fa_estimate_overhead_profit_correct",
          "text": "Is overhead and profit (O&P) applied correctly: only when the claim involves multiple trades that warrant general-contractor coordination, applied to the eligible line items, and not applied to items or trades the carrier's guidelines exclude?",
          "weight": 5,
          "applicability": "Score NOT_APPLICABLE if no O&P is included and the claim does not warrant it. Score FAIL if O&P is included on a single-trade repair or is missing on a clearly multi-trade repair that requires coordination.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order and Quality"
        },
        {
          "id": "fa_photos_labels_follow_estimate_flow",
          "text": "Do photo labels, captions, and room identifications follow the flow of the estimate so each scoped area can be matched to its photographs? A generic header label is acceptable when the caption identifies the room or area and the damage type. Do not penalize repetitive captions on a small, uniform claim.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_photo_quality",
          "categoryName": "Photographs Clear and In Order",
          "severity": "medium",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Photographs are clear and in order"
        },
        {
          "id": "fa_photos_consistent_clarity",
          "text": "Are the photographs of consistent quality: in focus, adequately lit, and framed so the damage or condition being documented is identifiable?",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_photo_quality",
          "categoryName": "Photographs Clear and In Order",
          "severity": "medium",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Photographs are clear and in order"
        },
        {
          "id": "fa_photos_relevant_and_complete_coverage",
          "text": "Do the photographs provide relevant and complete coverage of the claimed damage: overview and detail shots of each damaged area, the cause of loss where visible, and any pre-existing or unrelated conditions noted in the narrative? The standard is adequacy for the carrier to understand scope, not clinical completeness.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_photo_quality",
          "categoryName": "Photographs Clear and In Order",
          "applicability": "Score PARTIAL only when specific damaged areas or estimate line items have no photographic support whatsoever, or the photos are genuinely unusable.",
          "severity": "medium",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Photographs are clear and in order"
        },
        {
          "id": "fa_report_consistent_with_photos_and_estimate",
          "text": "Does the FA report agree with the photographs and the estimate? The areas, materials, quantities, and cause of loss described in the narrative must match what is photographed and scoped, with no contradictions.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): FA Report"
        },
        {
          "id": "fa_report_describes_damage_and_covered_damages",
          "text": "Does the FA report describe the damage observed and clearly identify which damages are covered (and which are not), including the cause of loss and its relationship to the date of loss? Brief narratives are acceptable when damages are accounted for in either the narrative or the photos.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): FA Report"
        },
        {
          "id": "fa_report_addresses_coverage_concerns_and_denials",
          "text": "Are coverage concerns, exclusions, and any partial or full denial recommendations documented with specific, articulable justification? Only flag a coverage issue when there is a clear, specific concern (excluded peril, policy condition not met, endorsement not applied, deductible misapplied); never flag a generic page reference.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report",
          "applicability": "Score NOT_APPLICABLE when the file presents no coverage concern and no denial recommendation and the report confirms coverage.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): FA Report"
        },
        {
          "id": "fa_report_addresses_subrogation",
          "text": "Does the FA report address subrogation potential? A statement that subrogation was considered and is not applicable is sufficient when the peril is weather-related or otherwise has no responsible third party.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report",
          "applicability": "Subrogation is generally NOT applicable for weather perils (wind, hail, storm, ice, falling trees). Score PARTIAL or FAIL only when a clear third-party negligence indicator (contractor error, defective product, neighbor negligence) is completely unacknowledged.",
          "severity": "medium",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): FA Report"
        },
        {
          "id": "fa_report_clear_and_grammatical",
          "text": "Is the FA report clear, well organized, and free of grammatical or spelling errors that could confuse the desk adjuster or the insured, with every required subsection completed with a meaningful entry rather than placeholder text?",
          "weight": 5,
          "severity": "low",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): FA Report",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report"
        },
        {
          "id": "fa_policy_provisions_and_sublimits_addressed",
          "text": "Are the policy provisions, sublimits, and endorsements that apply to this loss identified and correctly addressed in the FA documentation (for example a tree debris removal limit, a water backup or sump overflow limit, or a wind/hail requirement that interior water damage result from a storm-created opening)?",
          "weight": 10,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions and Estimating Guidelines",
          "applicability": "Applicable ONLY when the policy declarations, forms, or endorsements are included in the claim file. If the policy is not in the file, score NOT_APPLICABLE and do not flag the absence of policy analysis.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Unique Policy Provisions Addressed and Estimating guidelines followed"
        },
        {
          "id": "fa_policy_estimate_conforms_to_policy",
          "text": "Does the estimate conform to the policy? Scoped items must fall within covered perils and coverage parts, sublimits must not be exceeded without explanation, excluded items must be removed or separately identified, and the deductible and settlement basis (RCV/ACV) must be applied consistently with the policy.",
          "weight": 10,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions and Estimating Guidelines",
          "applicability": "Applicable ONLY when the policy declarations, forms, or endorsements are included in the claim file. If the policy is not in the file, score NOT_APPLICABLE and do not flag the absence of policy analysis.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Unique Policy Provisions Addressed and Estimating guidelines followed"
        },
        {
          "id": "fa_estimating_guidelines_followed",
          "text": "Does the estimate follow the carrier's estimating guidelines and standard estimating practice independent of the policy: no prohibited line items (for example masking and prep for paint scoped separately when the guidelines include it in the paint line), appropriate waste factors, the correct price list and units of measure, and minimum charges applied only where allowed?",
          "weight": 10,
          "applicability": "Always applicable, including when the policy is not in the file. Evaluate against the carrier's estimating guidelines when they are provided and against standard Xactimate estimating practice otherwise.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Unique Policy Provisions Addressed and Estimating guidelines followed",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions and Estimating Guidelines"
        }
      ],
      "scorecard_categories": [
        {
          "id": "fa_estimate_order",
          "label": "Estimate Operational Order and Quality",
          "max_score": 30
        },
        {
          "id": "fa_photo_quality",
          "label": "Photographs Clear and In Order",
          "max_score": 15
        },
        {
          "id": "fa_report",
          "label": "FA Report",
          "max_score": 25
        },
        {
          "id": "fa_policy_provisions",
          "label": "Unique Policy Provisions and Estimating Guidelines",
          "max_score": 30
        },
        {
          "id": "file_stack_order",
          "label": "File Stack Order",
          "max_score": 10
        },
        {
          "id": "payment_recommendations",
          "label": "Payment Recommendations Match",
          "max_score": 20
        },
        {
          "id": "da_report_quality",
          "label": "DA Report Quality",
          "max_score": 10
        },
        {
          "id": "policy_provisions",
          "label": "Unique Policy Provisions Addressed",
          "max_score": 25
        },
        {
          "id": "prior_losses",
          "label": "Prior Losses Addressed",
          "max_score": 10
        },
        {
          "id": "denial_letters",
          "label": "Denial Letters Correct",
          "max_score": 25
        }
      ],
      "system_prompt_override": "You are a carrier-grade insurance audit assistant evaluating a finalized Assurant claim file.\n\nEvaluate TWO separate scorecards:\n1. FIELD ADJUSTER (FA) — covers estimate operational order and line-item quality, photograph clarity and sequence, FA report quality, and policy provisions plus carrier estimating guidelines.\n2. DESK ADJUSTER (DA) — covers file stack order, payment recommendation consistency, DA report quality, unique policy provisions, prior loss review, and denial letters.\n\nFor each question return:\n- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE\n- root_issue: short snake_case key grouping related problems\n- issue: the specific problem found (empty string if PASS)\n- impact: why it matters to Assurant (empty string if PASS)\n- fix: exact actionable fix — no vague language (empty string if PASS)\n- evidence_locations: where in the document evidence was found\n- confidence: 0-100\n\nIMPORTANT — CONCISE ISSUE DESCRIPTIONS:\n- Identify the root problem without restating the entire finding.\n- Good examples: \"Duplicate drywall line items in Bedroom 2\", \"O&P applied to a single-trade roof repair\", \"Policy not in file — provisions scored NOT_APPLICABLE\".\n- Bad examples: long paragraphs restating the FA report or re-explaining the entire claim.\n\nESTIMATE ORDER AND QUALITY:\n- Expected sequence within each area: floors → walls → ceilings → accessories. Exterior and roof scope comes before interior scope. Debris removal is listed at the end.\n- If the narrative states that an area was not inspected and nothing was scoped for it, do not flag ordering for that area; score the ordering question NOT_APPLICABLE for that area.\n- Every line item must be supported by the photos or the narrative. Consequential items (anti-microbial treatment, insulation, demolition, debris removal) are implied when the parent damage is documented.\n- Flag duplicate line items: the same repair billed twice for the same area, or an item already included in a bundled line.\n- Overhead and profit belongs only on multi-trade repairs that warrant general-contractor coordination, and only on eligible line items.\n\nPHOTOGRAPHS:\n- Evaluate both the header label and the adjuster caption; the caption is the primary diagnostic field.\n- The standard is adequacy, not clinical completeness. Score PARTIAL only when specific damaged areas or line items have no photographic support, or the photos are unusable.\n- On a small, uniform claim, similar or identical captions are acceptable.\n\nFA REPORT:\n- Brief narratives are acceptable. Score on whether damage areas in the estimate are accounted for in the narrative OR the photos, not both.\n- Coverage flags need specific, articulable justification (excluded peril, policy condition not met, endorsement not applied, deductible misapplied). Never flag a generic page reference.\n- Subrogation is generally not applicable for weather perils; a statement that it was considered is sufficient. Flag only a clearly unacknowledged third-party negligence indicator.\n\nPOLICY PROVISIONS AND ESTIMATING GUIDELINES (CRITICAL):\n- The policy is frequently NOT included in an Assurant claim file. When the policy declarations, forms, and endorsements are absent, score every policy-provision and policy-conformance question NOT_APPLICABLE and do not penalize the file for missing policy analysis.\n- When the policy IS in the file, evaluate the estimate and narrative against its provisions, sublimits, endorsements, and exclusions. Typical examples: tree debris removal limits, water backup or sump overflow limits, and a wind/hail requirement that interior water damage result from a storm-created opening.\n- The estimating-guidelines question is ALWAYS applicable. Evaluate the estimate against the carrier's estimating guidelines when they are provided and against standard estimating practice otherwise (for example masking and prep for paint scoped separately when the guidelines include it in the paint line item).\n\nDESK ADJUSTER FILE:\n- File stack order: DA report → Statement of Loss → Payment Letter → Other Letters → Estimate → Photos → Sketch → Prior Loss report.\n- The DA report, Statement of Loss, and Payment Letter must agree on amounts with the correct deductible applied. If the DA report states that no payment is recommended and contains no payment figures, payment-matching and payment-letter questions are NOT_APPLICABLE.\n- The DA report should summarize concisely. Do not penalize brevity; flag copy/paste only when the report consists primarily of verbatim FA text.\n- Prior losses within five years of the date of loss must be reviewed and their relevance stated. The current claim will appear on its own prior-loss report; do not flag it as an unaddressed prior.\n- If no denial exists on the claim, all denial letter questions are NOT_APPLICABLE and the no-denial weighting applies.\n\nGENERAL:\n- Multiple questions sharing the same root cause MUST share the same root_issue value.\n- Return JSON only. No markdown, no code fences."
    }
    $assurant_ruleset$::jsonb
  ),
  (
    'andover',
    '2.0',
    $andover_ruleset$
    {
      "version": "2.0",
      "da_questions": [
        {
          "id": "da_file_stack_da_report_on_top",
          "text": "Is the DA report at the top of the file stack?",
          "weight": 2,
          "weightIfNoDenial": 3,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_file_stack",
          "categoryName": "File Stack Order"
        },
        {
          "id": "da_file_stack_sol_after_report",
          "text": "Is the Statement of Loss (SOL) positioned after the DA report?",
          "weight": 1,
          "weightIfNoDenial": 2,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_file_stack",
          "categoryName": "File Stack Order"
        },
        {
          "id": "da_file_stack_payment_letter",
          "text": "Is the Payment Letter properly placed after the SOL? NOTE: If the DA report explicitly states that no payment is being recommended or requested at this time, and there are no payment financials in the DA report, a Payment Letter is NOT required. Score NOT_APPLICABLE in this scenario — do not flag the absence of a payment letter.",
          "weight": 2,
          "weightIfNoDenial": 2,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_file_stack",
          "categoryName": "File Stack Order"
        },
        {
          "id": "da_file_stack_other_letters",
          "text": "Are other letters (denial, CWP, etc.) properly filed in the stack?",
          "weight": 1,
          "weightIfNoDenial": 2,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_file_stack",
          "categoryName": "File Stack Order"
        },
        {
          "id": "da_file_stack_estimate_photos_sketch",
          "text": "Are the Estimate, Photos, and Sketch in correct order in the stack?",
          "weight": 2,
          "weightIfNoDenial": 3,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_file_stack",
          "categoryName": "File Stack Order"
        },
        {
          "id": "da_file_stack_prior_loss_at_end",
          "text": "Is the Prior Loss (ISO) report placed at the end of the file stack?",
          "weight": 2,
          "weightIfNoDenial": 3,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_file_stack",
          "categoryName": "File Stack Order"
        },
        {
          "id": "da_payment_da_report_sol_agree",
          "text": "Do the DA report and SOL payment recommendations agree? NOTE: If the DA report explicitly states no payment is being recommended or requested at this time, and no payment financials appear in the DA report, score NOT_APPLICABLE for all payment matching questions. The absence of a SOL or payment letter is expected in this scenario.",
          "weight": 5,
          "weightIfNoDenial": 7,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_payment_match",
          "categoryName": "Payment Recommendations Match"
        },
        {
          "id": "da_payment_sol_payment_letter_agree",
          "text": "Do the SOL and Payment Letter amounts match? NOTE: If no payment is recommended per the DA report, score NOT_APPLICABLE.",
          "weight": 5,
          "weightIfNoDenial": 6,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_payment_match",
          "categoryName": "Payment Recommendations Match"
        },
        {
          "id": "da_payment_deductible_correct",
          "text": "Is the correct deductible applied across all payment documents?",
          "weight": 5,
          "weightIfNoDenial": 6,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_payment_match",
          "categoryName": "Payment Recommendations Match"
        },
        {
          "id": "da_payment_all_three_consistent",
          "text": "Are the DA report, SOL, and Payment Letter internally consistent with no contradictions? NOTE: If no payment is recommended, score NOT_APPLICABLE.",
          "weight": 5,
          "weightIfNoDenial": 6,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_payment_match",
          "categoryName": "Payment Recommendations Match"
        },
        {
          "id": "da_report_not_over_copy_paste",
          "text": "Does the DA report avoid excessive verbatim copy/pasting from the FA report? A concise DA report that summarizes key facts without large verbatim blocks = PASS. Only score PARTIAL if the DA report consists primarily of copy/pasted FA text with minimal desk-level synthesis. Do NOT penalize for brevity or for echoing similar facts in the DA own words.",
          "weight": 5,
          "weightIfNoDenial": 8,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_report",
          "categoryName": "DA Report"
        },
        {
          "id": "da_report_summarizes_effectively",
          "text": "Does the DA report effectively summarize the claim facts, coverage analysis, and payment rationale? Brief summaries are acceptable for straightforward claims. Only score PARTIAL if material coverage nuances, payment reasoning, or unresolved open items of real significance are left completely unaddressed. CRITICAL: If the claim has open liability exposure — meaning the carrier may owe future payments NOT simply related to an unpredictable contractor supplement (e.g., pending retaining wall ownership determination, pending additional inspection of inaccessible areas, pending contents inventory) — the DA report MUST acknowledge this. If open liability exists and the report is marked as Final or First and Final without acknowledging the pending exposure, score FAIL. The report should be a First Report with a follow-up diary set, not a Final.",
          "weight": 5,
          "weightIfNoDenial": 7,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_report",
          "categoryName": "DA Report"
        },
        {
          "id": "da_policy_ho6_master_policy",
          "text": "Is the HO6 master policy properly addressed when applicable?",
          "weight": 8,
          "weightIfNoDenial": 10,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_policy_provisions",
          "categoryName": "Unique Policy Provisions (DA)"
        },
        {
          "id": "da_policy_mlc_addressed",
          "text": "Is the Managed Lumber Calculation (MLC) properly addressed?",
          "weight": 9,
          "weightIfNoDenial": 10,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_policy_provisions",
          "categoryName": "Unique Policy Provisions (DA)"
        },
        {
          "id": "da_policy_hsb_covered_items",
          "text": "Are HSB (Hartford Steam Boiler) covered items properly identified and addressed?",
          "weight": 8,
          "weightIfNoDenial": 10,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_policy_provisions",
          "categoryName": "Unique Policy Provisions (DA)"
        },
        {
          "id": "da_prior_loss_iso_at_end",
          "text": "Is the ISO report included at the end of the file?",
          "weight": 3,
          "weightIfNoDenial": 5,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_prior_losses",
          "categoryName": "Prior Losses Addressed"
        },
        {
          "id": "da_prior_loss_5year_addressed",
          "text": "Are prior losses within 5 years of the CLAIM DATE reviewed and addressed in the DA report? The 5-year window is anchored to the claim date — not today date. Priors older than 5 years from the claim date are low concern. CRITICAL — CURRENT CLAIM ON ISO REPORT: The current claim will appear on its own ISO/ClaimSearch report. Do NOT flag the current claim as an unaddressed prior loss. Match by date of loss and property address, not by claim number format (formats vary between systems). When priors exist: score PASS if DA explicitly states they were reviewed and are not relevant (e.g., dissimilar perils, outside 5-year window). Score PARTIAL if DA is completely silent on priors that exist in the ISO report AND those priors are within 5 years with similar peril. For dissimilar perils (e.g., mold or falling objects vs. current wind claim), low concern even if within 5 years. THREE-TIER LOGIC: (a) No relevant priors within 5 years + DA silent on priors = PASS (no flag needed). (b) Relevant priors within 5 years (same/similar peril, overlapping area) + DA silent = FAIL. (c) ISO report missing from the file stack entirely = FAIL, UNLESS DA report explicitly notes that no priors exist and no report is available.",
          "weight": 4,
          "weightIfNoDenial": 5,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_prior_losses",
          "categoryName": "Prior Losses Addressed"
        },
        {
          "id": "da_prior_loss_impact_documented",
          "text": "Is the relevance of prior losses documented? For priors with dissimilar perils or outside the 5-year window from the claim date, a brief statement that they were reviewed and are not relevant is sufficient — score as PASS. If no relevant priors exist within 5 years (only the current claim on ISO, or only old/dissimilar priors), score PASS — detailed impact analysis is not required. Only require detailed impact analysis if priors share the same or similar peril AND involve overlapping damage areas AND are within 5 years of the claim date.",
          "weight": 3,
          "weightIfNoDenial": 5,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_prior_losses",
          "categoryName": "Prior Losses Addressed"
        },
        {
          "id": "da_denial_letter_sent",
          "text": "Was a denial letter sent when coverage was denied?",
          "weight": 10,
          "weightIfNoDenial": 0,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_denial_letters",
          "categoryName": "Denial Letters"
        },
        {
          "id": "da_denial_correct_policy_language",
          "text": "Does the denial letter cite the correct policy language and exclusions?",
          "weight": 10,
          "weightIfNoDenial": 0,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_denial_letters",
          "categoryName": "Denial Letters"
        },
        {
          "id": "da_denial_complete_and_clear",
          "text": "Is the denial letter complete, clear, and free of errors?",
          "weight": 5,
          "weightIfNoDenial": 0,
          "section": "da",
          "scorecard": "DA",
          "categoryKey": "da_denial_letters",
          "categoryName": "Denial Letters"
        }
      ],
      "fa_questions": [
        {
          "id": "fa_estimate_floors_walls_ceilings_order",
          "text": "Does the estimate follow proper operational order for floors, walls, and ceilings? NOTE: If the narrative states that an area was not inspected (e.g., due to ice/snow, inaccessibility, safety concerns) AND no covered damage was observed or scoped for that area, do NOT flag operational order issues related to that uninspected area. Only evaluate operational order for areas that were actually inspected and scoped in the estimate.",
          "weight": 7,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order"
        },
        {
          "id": "fa_estimate_accessories_placement",
          "text": "Are accessories (trim, fixtures, hardware) properly placed after their associated surfaces in the estimate?",
          "weight": 4,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order"
        },
        {
          "id": "fa_estimate_roof_before_interior",
          "text": "Is the roof section placed before interior items in the estimate? NOTE: If the roof was not inspected (e.g., ice/snow, inaccessibility) and no roof damage was scoped, this question is NOT_APPLICABLE. Do not flag missing roof section when the narrative explains the roof was not inspected and no covered roof damage was identified.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order"
        },
        {
          "id": "fa_estimate_debris_removal_at_end",
          "text": "Is debris removal listed at the end of the estimate?",
          "weight": 4,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order"
        },
        {
          "id": "fa_estimate_no_duplicate_line_items",
          "text": "Is the estimate free of duplicate line items: the same repair, material, or labor billed more than once for the same area, or an item that is already included in a bundled or component line?",
          "weight": 5,
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order"
        },
        {
          "id": "fa_estimate_overhead_profit_correct",
          "text": "Is overhead and profit (O&P) applied correctly: only when the claim involves multiple trades that warrant general-contractor coordination, applied to the eligible line items, and not applied to items or trades the carrier's guidelines exclude?",
          "weight": 5,
          "applicability": "Score NOT_APPLICABLE if no O&P is included and the claim does not warrant it. Score FAIL if O&P is included on a single-trade repair or is missing on a clearly multi-trade repair that requires coordination.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Estimate is in operational order",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_estimate_order",
          "categoryName": "Estimate Operational Order"
        },
        {
          "id": "fa_photos_labels_follow_estimate",
          "text": "Evaluate BOTH the photo header label AND the adjuster written caption/description for each photo. A generic header label (e.g., Right Elevation, Bedroom 1) is acceptable if the adjuster caption provides specificity (e.g., water damaged ceiling from ice dams along eave line). Do NOT penalize generic labels when descriptive captions are present — the caption is the primary diagnostic field. If photo labels/captions describe the damage type and location, accept the photo as sufficient documentation even if the visual damage is ambiguous in the image itself — humans also struggle to confirm damage from photos alone. REPETITIVE CAPTIONS — apply a proportionality test: Small or simple claim (20–40 photos, uniform damage type, one or two rooms): similar or identical captions are ACCEPTABLE. Score PASS. Complex claim (many photos across multiple rooms or damage types): if the majority of captions are identical generic descriptions that fail to differentiate distinct damage areas (e.g., 300 photos all labeled water damaged material with no room/area differentiation) → score PARTIAL. The test is: do the captions collectively allow the carrier to understand what each photo documents? If yes, score PASS. PHOTO REPORT FORMAT: Evaluate separately from caption quality. If the photo report is formatted with an unusual layout (not the standard 2 images per page), this may be flagged as a formatting concern independent of caption quality.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_photo_quality",
          "categoryName": "Photographs Clear and In Order"
        },
        {
          "id": "fa_photos_consistent_quality",
          "text": "Are photographs of consistent quality (clear, well-lit, in focus)?",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_photo_quality",
          "categoryName": "Photographs Clear and In Order"
        },
        {
          "id": "fa_photos_adequate_coverage",
          "text": "Do photographs adequately support the claimed damages? Score PASS if photos are sufficient for the carrier to understand the scope of damage. Score PARTIAL only if specific estimate line items have zero photographic support OR photos are genuinely unusable. IMPLIED NECESSITY ITEMS — do NOT require standalone photos for the following when the parent damage is documented: Anti-microbial treatment / cleaning agents: implied when water damage to wall cavities, framing, or ceiling assemblies is documented in photos. Insulation replacement: implied when water damage to wall or ceiling cavities is documented. Debris removal: implied when exterior damage (tree, wind, hail) is documented. Demolition of damaged drywall or finish materials: implied when water or structural damage is documented. MITIGATION VENDOR CHECK: If a mitigation vendor, remediation company, or water mitigation contractor is referenced anywhere in the file, do NOT flag missing mitigation line items (anti-microbial, drying equipment) in the FA estimate — the vendor handles these separately. MITIGATION NOT ENGAGED: If the narrative explicitly states that the insured has not engaged, not hired, or declined mitigation services, do NOT flag missing mitigation-in-progress photos. Only flag missing mitigation photos when mitigation WAS performed per the narrative or invoices. If no mitigation vendor is referenced and narrative states mitigation was not engaged, the FA may include limited mitigation items in the estimate — this is acceptable and photos of mitigation in progress are NOT required.",
          "weight": 5,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_photo_quality",
          "categoryName": "Photographs Clear and In Order"
        },
        {
          "id": "fa_report_describes_photos_estimate",
          "text": "Does the FA report provide sufficient description of the damages observed? Brief narratives are acceptable — do not penalize for conciseness. Score PASS if damages are generally accounted for in either the narrative or the photos. Score PARTIAL only if specific damage areas appear in the estimate but have no corresponding support in either the narrative or the photos. MITIGATION JUSTIFICATION: If the narrative explicitly states that the insured has not engaged, not hired, or declined a mitigation team, this IS acceptable justification for the mitigation approach. Accept the following as valid mitigation justification: (a) insured has not engaged/hired mitigation, (b) insured declined mitigation, (c) limited mitigation included in repair estimate because no vendor engaged. Only flag missing mitigation justification if water/mold damage exists AND mitigation was actually performed but not explained, OR if the narrative is completely silent on mitigation when water damage is present.",
          "weight": 7,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report"
        },
        {
          "id": "fa_report_addresses_coverage",
          "text": "Does the FA report address coverage considerations and any coverage concerns? NOTE: Coverage flags must include specific, articulable justification. If you cannot articulate the actual coverage issue beyond a generic page reference, do not flag it. Only flag coverage issues when there is a clear, specific concern (e.g., excluded peril, policy condition not met, endorsement not applied).",
          "weight": 7,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report"
        },
        {
          "id": "fa_report_addresses_subro",
          "text": "Does the FA report address subrogation potential where applicable? NOTE: For weather-related perils (wind, hail, storm, falling objects/trees, ice dams, act of god), subrogation is generally NOT applicable. A canned carrier statement such as subrogation will be assessed by Andover is CORRECT and sufficient — score as PASS. Only score PARTIAL or FAIL if there is a clear third-party negligence indicator (contractor error, defective product, direct neighbor negligence) that is completely unacknowledged. Do NOT flag inverse liability scenarios (policyholder property causing third-party damage) as this is outside FA scope for Andover.",
          "weight": 6,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report"
        },
        {
          "id": "fa_report_clear_and_grammatical",
          "text": "Is the FA report clear, well organized, and free of grammatical or spelling errors that could confuse the desk adjuster or the insured, with every required subsection completed with a meaningful entry rather than placeholder text?",
          "weight": 5,
          "severity": "low",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): FA Report",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_report",
          "categoryName": "FA Report"
        },
        {
          "id": "fa_sublimits_addressed",
          "text": "Are applicable sublimits identified and addressed in the FA documentation?",
          "weight": 8,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions (FA)"
        },
        {
          "id": "fa_water_backup_addressed",
          "text": "Is water backup coverage properly addressed when applicable?",
          "weight": 8,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions (FA)"
        },
        {
          "id": "fa_no_storm_created_opening",
          "text": "Is the no storm created opening provision addressed when applicable (wind/hail claims)?",
          "weight": 8,
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions (FA)"
        },
        {
          "id": "fa_estimating_guidelines_followed",
          "text": "Does the estimate follow the carrier's estimating guidelines and standard estimating practice independent of the policy: no prohibited line items (for example masking and prep for paint scoped separately when the guidelines include it in the paint line), appropriate waste factors, the correct price list and units of measure, and minimum charges applied only where allowed?",
          "weight": 6,
          "applicability": "Always applicable, including when the policy is not in the file. Evaluate against the carrier's estimating guidelines when they are provided and against standard Xactimate estimating practice otherwise.",
          "severity": "high",
          "sourceReference": "Generic FA scorecard (docs/sample generic scorecard.xlsx): Unique Policy Provisions Addressed and Estimating guidelines followed",
          "section": "fa",
          "scorecard": "FA",
          "categoryKey": "fa_policy_provisions",
          "categoryName": "Unique Policy Provisions (FA)"
        }
      ],
      "scorecard_categories": [
        {
          "id": "fa_estimate_order",
          "label": "Estimate Operational Order",
          "max_score": 30
        },
        {
          "id": "fa_photo_quality",
          "label": "Photographs Clear and In Order",
          "max_score": 15
        },
        {
          "id": "fa_report",
          "label": "FA Report",
          "max_score": 25
        },
        {
          "id": "fa_policy_provisions",
          "label": "Unique Policy Provisions (FA)",
          "max_score": 30
        },
        {
          "id": "da_file_stack",
          "label": "File Stack Order",
          "max_score": 15
        },
        {
          "id": "da_payment_match",
          "label": "Payment Recommendations Match",
          "max_score": 25
        },
        {
          "id": "da_report",
          "label": "DA Report",
          "max_score": 15
        },
        {
          "id": "da_policy_provisions",
          "label": "Unique Policy Provisions (DA)",
          "max_score": 30
        },
        {
          "id": "da_prior_losses",
          "label": "Prior Losses Addressed",
          "max_score": 15
        },
        {
          "id": "da_denial_letters",
          "label": "Denial Letters",
          "max_score": 25
        }
      ],
      "system_prompt_override": "You are a carrier-grade insurance audit assistant evaluating a finalized Andover claim file submitted by Pilot Catastrophe Services.\n\nEvaluate TWO separate scorecards:\n1. FIELD ADJUSTER (FA) — covers estimate operational order, photograph quality and sequence, FA report completeness, and unique policy provisions (sublimits, water backup, storm created opening).\n2. DESK ADJUSTER (DA) — covers file stack order, payment recommendation consistency, DA report quality, unique policy provisions (HO6/master policy, MLC, HSB), prior loss review, and denial letters.\n\nFor each question return:\n- answer: PASS, PARTIAL, FAIL, or NOT_APPLICABLE\n- root_issue: short snake_case key grouping related problems\n- issue: the specific problem found (empty string if PASS)\n- impact: why it matters to Andover (empty string if PASS)\n- fix: exact actionable fix — no vague language (empty string if PASS)\n- evidence_locations: where in the document evidence was found\n- confidence: 0-100\n\nIMPORTANT — CONCISE ISSUE DESCRIPTIONS:\n- When flagging issues, produce concise summaries that identify the root problem without restating the entire finding.\n- Good examples: \"DA/FA conflict on mitigation and contractor involvement\", \"DA report summarizes FA report — redundancy\", \"Prior loss from 2004 outside 5-year window — not relevant\".\n- Bad examples: long paragraphs restating what was already in the FA report or re-explaining the entire claim.\n\nANDOVER-SPECIFIC RULES:\n\nFILE STACK ORDER:\n- Required sequence: DA report → SOL → Payment Letter → Other Letters → Estimate → Photos → Sketch → Prior Loss (ISO).\n\nNO PAYMENT RECOMMENDED — DOCUMENT SUPPRESSION:\n- If the DA report explicitly states that no payment is being recommended or requested at this time, AND no payment financials appear in the DA report:\n  (a) A Payment Letter is NOT required. Score payment letter placement as NOT_APPLICABLE.\n  (b) Payment matching questions (DA vs SOL vs Payment Letter) should be scored NOT_APPLICABLE.\n  (c) Do NOT flag the absence of a payment letter or SOL payment inconsistencies.\n- This is distinct from a denial — no-payment-recommended means the claim may still be open with a follow-up pending.\n\nSOL (STATEMENT OF LOSS) RULES:\n- Andover provides a SOL on every report, even when no payment is recommended, UNLESS it is strictly a non-covered loss and no estimate was produced.\n- Do NOT flag SOL presence as a mismatch when no payment is recommended — the SOL is standard.\n- Only flag SOL issues when: (a) payment IS recommended but SOL amounts don't match, or (b) a non-covered loss with no estimate still has a SOL with payment figures.\n\nPAYMENT MATCHING:\n- DA report, SOL, and Payment Letter must agree on amounts with correct deductible applied.\n- Exception: When no payment is recommended per above rule, score payment matching as NOT_APPLICABLE.\n\nDA REPORT — REDUNDANCY STANDARD:\n- The DA report purpose is to summarize concisely, not to add exhaustive analysis.\n- Score PASS if the DA report is concise and avoids large verbatim blocks from the FA report.\n- Score PARTIAL only if the DA report consists primarily of copy/pasted FA report text with minimal desk-level synthesis.\n- Do NOT penalize for brief summaries. A short DA report that covers key points without verbatim duplication = PASS.\n- Do NOT require policy interpretation breakdowns, reserve justifications, or gap analyses unless the claim is complex and they are clearly missing.\n\nDA REPORT — CONTENT STANDARD:\n- Brief, straightforward summaries are acceptable for routine claims.\n- Score PARTIAL only if material coverage nuances, payment reasoning, or unresolved open items of genuine significance are completely unaddressed.\n- Minor open items (small incidental damages, trivial ownership questions) do not require follow-up report status or detailed next steps.\n\nDA REPORT — FUTURE PAYMENT EXPOSURE (CRITICAL):\n- PRIORITIZE detecting open liability exposure over redundancy issues.\n- If the carrier may owe future payments that are NOT simply related to an unpredictable contractor supplement, the DA report MUST acknowledge this and the report should NOT be marked as Final or First and Final.\n- Examples of open liability requiring follow-up: pending retaining wall ownership determination, pending inspection of inaccessible areas, pending contents inventory with potential for significant additional payment, pending additional investigation that could change coverage.\n- If open liability exists and the report is marked Final or First and Final without acknowledging the pending exposure → score FAIL on da_report_summarizes_effectively.\n- The correct report status in these cases is First Report with a follow-up diary (typically 30 days).\n- Exception: unpredictable contractor supplements are routine and do NOT require the report to be held open.\n\nPRIOR LOSS EVALUATION (CRITICAL — UPDATED RULES):\n- The 5-year window is calculated from the CLAIM DATE, not today date or the processing date.\n- Prior losses older than 5 years from the claim date are LOW CONCERN and do not require detailed analysis.\n\nCURRENT CLAIM ON ISO REPORT:\n- The current claim WILL appear on its own ISO/ClaimSearch report. This is normal.\n- Do NOT flag the current claim as an unaddressed prior loss.\n- Match by date of loss and property address to identify the current claim, not by claim number format (formats vary between carrier systems and ISO — e.g., CLM-00064715 vs CLM00064715 or HP2493454).\n\nTHREE-TIER PRIOR LOSS LOGIC:\n(a) No relevant priors within 5 years of claim date (only old losses, dissimilar perils, or only the current claim on ISO) + DA report silent on priors OR states no related priors = PASS. No flag needed.\n(b) Relevant priors exist within 5 years (same/similar peril AND overlapping damage area) + DA report is completely silent on those priors = FAIL.\n(c) ISO/prior loss report is missing from the file stack entirely = FAIL, UNLESS the DA report explicitly notes that no priors exist and no report is available.\n\nPRIOR LOSS DETAIL REQUIREMENTS:\n- When priors exist within 5 years of the claim date:\n  (a) If perils are DISSIMILAR (e.g., prior mold or falling objects vs. current wind/ice dam claim), concern level is LOW even within 5 years.\n  (b) If DA explicitly states priors were reviewed and are not relevant → score PASS.\n  (c) Only score FAIL if DA is completely silent on priors AND those priors involve the same/similar peril with overlapping damage areas within 5 years.\n- A brief statement such as \"prior losses reviewed, not relevant — dissimilar perils / outside 5-year window\" = adequate = PASS.\n- A statement such as \"There are no related prior losses that we are aware of\" = adequate when ISO confirms no relevant priors = PASS.\n- High concern threshold: same or similar peril + overlapping damage area + within 5 years of claim date.\n\nPHOTO LABEL AND CAPTION EVALUATION:\n- Evaluate BOTH the photo header label AND the adjuster written caption/description beneath each photo.\n- The caption is the primary diagnostic field. A generic header label is acceptable when the caption provides specificity.\n- Example of acceptable: label = \"Bedroom 1\", caption = \"water damaged ceiling from ice dams along eave line\" → PASS.\n- Example of a problem: label = \"damage\" and caption is also missing or identically generic across all photos → PARTIAL.\n- If photo labels/captions describe the damage type and location, accept the photo as sufficient documentation even if the visual damage is ambiguous in the image — humans also struggle to confirm damage from photos alone.\n- REPETITIVE CAPTIONS — apply a proportionality test:\n  (a) Small or simple claim (20–40 photos, uniform damage type, one or two affected rooms): similar or identical captions are ACCEPTABLE → PASS.\n  (b) Complex claim (many photos, multiple rooms, multiple damage types): if the majority of captions are identical and provide no area or material differentiation → PARTIAL.\n  The test: do the captions collectively allow the carrier to identify what each photo documents? If yes → PASS.\n- PHOTO REPORT FORMAT: Evaluate separately from caption quality. If the photo report uses a non-standard layout (not the typical 2 images per page format), this is a formatting concern that may be flagged independently of caption quality.\n\nPHOTO COVERAGE STANDARD:\n- The standard is ADEQUACY, not completeness or clinical perfection.\n- Score PASS if photos reasonably document the claimed damages at a level sufficient for the carrier to understand the scope.\n- Score PARTIAL only if specific line items in the estimate have no photographic support whatsoever, or existing photos are genuinely unusable.\n\nIMPLIED NECESSITY ITEMS — PHOTO SUPPORT NOT REQUIRED:\nThe following estimate line items are standard consequential scope items that do NOT require standalone photographs when the underlying parent damage is documented:\n- Anti-microbial treatment / cleaning agents: implied when water damage to wall cavities, framing, or ceiling assemblies is documented in photos or narrative.\n- Insulation replacement: implied when water damage to wall or ceiling cavities is documented.\n- Debris removal: implied when exterior damage (tree, wind, hail, ice) is documented.\n- Demolition of damaged drywall or finish materials: implied when water or structural damage is documented.\nIf the parent damage is documented, score these line items as PASS even without standalone photos of the treatment or material.\n\nMITIGATION RULES (CRITICAL — UPDATED):\n\nMITIGATION VENDOR CROSS-CHECK:\n- Before flagging missing mitigation items (anti-microbial spray, drying equipment, moisture readings) in the FA estimate, check whether a mitigation vendor, water remediation company, or mitigation contractor is referenced in any document in the file.\n- If a mitigation vendor IS referenced → do NOT flag missing mitigation line items or moisture documentation in the FA estimate. The vendor handles these separately on HO/commercial claims. Score NOT_APPLICABLE.\n- If NO mitigation vendor is referenced → the FA may include mitigation items in the estimate. Implied necessity items (anti-microbial, insulation) require no standalone photos as long as the underlying water damage is documented.\n\nMITIGATION NOT ENGAGED — VALID JUSTIFICATION:\n- If the narrative explicitly states ANY of the following, this IS valid and acceptable mitigation justification:\n  (a) \"The insured has not engaged a mitigation team/company/contractor\"\n  (b) \"The insured declined mitigation services\"\n  (c) \"Mitigation services had not been performed at the time of inspection\"\n  (d) \"Limited mitigation included in our repair estimate\" (because no vendor was engaged)\n- When mitigation is not engaged: do NOT flag \"report does not justify mitigation\" or \"insufficient mitigation documentation\".\n- When mitigation is not engaged: do NOT flag missing mitigation-in-progress photos. There is no mitigation in progress to photograph.\n- Only flag missing mitigation justification when: water/mold damage exists AND mitigation WAS actually performed (vendor invoices, drying logs present) but is not explained in the narrative.\n\nCONTRACTOR VS MITIGATION CONFLICT:\n- If the FA report references a contractor who will also handle damaged material removal and drying, AND the DA report does not address this overlap, flag as: \"DA/FA have conflicting information on mitigation and contractor involvement.\" Keep the flag concise.\n\nESTIMATE OPERATIONAL ORDER — UNINSPECTED AREAS:\n- If the narrative states that an area was NOT inspected (e.g., due to ice/snow accumulation, inaccessibility, safety concerns) AND no covered damage was observed or scoped for that area:\n  (a) Do NOT flag operational order issues related to that uninspected area.\n  (b) If roof was not inspected and no roof scope exists, do not flag \"roof before interior\" ordering.\n  (c) Score the operational order question as NOT_APPLICABLE for uninspected/unscoped areas.\n\nFA NARRATIVE / DESCRIPTION STANDARD:\n- FA adjusters vary widely in verbosity. Brief narratives are normal and acceptable.\n- Do NOT penalize for concise narratives when photo documentation is adequate.\n- Score based on whether damage areas in the estimate are accounted for in either the narrative OR the photos — not both.\n- Only score PARTIAL/FAIL if specific damage areas appear in the estimate but have no corresponding support in either the narrative or the photos.\n- Do NOT require explicit photo ID references or cross-indexing in the narrative text.\n\nCOVERAGE ERROR SPECIFICITY:\n- Coverage flags must include specific, articulable justification.\n- If the model cannot articulate what the actual coverage issue is beyond a generic page reference, do NOT flag it.\n- Only flag coverage issues when there is a clear, specific concern (e.g., excluded peril, policy condition not met, endorsement not applied, deductible misapplied).\n\nSUBROGATION:\n- Subrogation is generally NOT applicable for weather-related perils (wind, hail, storm, falling objects/trees, ice dams, act of god).\n- A canned carrier statement such as \"subrogation will be assessed by Andover Companies\" is CORRECT and sufficient — score as PASS.\n- Only score PARTIAL or FAIL if there is a clear third-party negligence indicator (contractor error, defective product, direct neighbor negligence) AND it is completely unacknowledged.\n- Do NOT flag inverse liability scenarios — liability claims are outside Pilot scope for Andover.\n\nPOLICY PROVISIONS:\n- HO6 master policy, MLC (Managed Lumber Calculation), and HSB covered items must be addressed when applicable.\n- Mark NOT_APPLICABLE when the claim type or policy clearly does not involve these provisions.\n\nDENIAL LETTERS:\n- If no denial exists on the claim, all denial letter questions are NOT_APPLICABLE and alternate no-denial weighting applies.\n\nGENERAL:\n- Multiple questions sharing the same root cause MUST share the same root_issue value.\n- Return JSON only. No markdown, no code fences."
    }
    $andover_ruleset$::jsonb
  );

-- Structural preflight on the embedded rulesets: the version label matches the
-- JSON, the four FA categories sum to the generic scorecard weights, every
-- scorecard category's max_score equals the FA weight sum for FA categories,
-- question ids are unique, and every question points at a declared category.
DO $ruleset_shape_preflight$
DECLARE
  offending text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM assurant_realignment_rulesets AS candidate
    WHERE candidate.ruleset->>'version' IS DISTINCT FROM candidate.version_label
       OR jsonb_typeof(candidate.ruleset->'fa_questions') <> 'array'
       OR jsonb_typeof(candidate.ruleset->'da_questions') <> 'array'
       OR jsonb_typeof(candidate.ruleset->'scorecard_categories') <> 'array'
       OR jsonb_array_length(candidate.ruleset->'fa_questions') = 0
       OR jsonb_array_length(candidate.ruleset->'da_questions') = 0
  ) THEN
    RAISE EXCEPTION
      'An embedded carrier ruleset is missing its version label or question arrays'
      USING ERRCODE = '23514';
  END IF;

  WITH fa_totals AS (
    SELECT
      candidate.carrier_key,
      question->>'categoryKey' AS category_key,
      sum((question->>'weight')::integer) AS total
    FROM assurant_realignment_rulesets AS candidate
    CROSS JOIN LATERAL jsonb_array_elements(candidate.ruleset->'fa_questions')
      AS question
    GROUP BY candidate.carrier_key, question->>'categoryKey'
  ),
  expected (category_key, total) AS (
    VALUES
      ('fa_estimate_order', 30),
      ('fa_photo_quality', 15),
      ('fa_report', 25),
      ('fa_policy_provisions', 30)
  ),
  mismatches AS (
    SELECT candidate.carrier_key, expected.category_key
    FROM assurant_realignment_rulesets AS candidate
    CROSS JOIN expected
    LEFT JOIN fa_totals
      ON fa_totals.carrier_key = candidate.carrier_key
     AND fa_totals.category_key = expected.category_key
    WHERE fa_totals.total IS DISTINCT FROM expected.total
    UNION ALL
    SELECT fa_totals.carrier_key, fa_totals.category_key
    FROM fa_totals
    WHERE fa_totals.category_key NOT IN (SELECT category_key FROM expected)
  )
  SELECT string_agg(carrier_key || ':' || category_key, ', ')
  INTO offending
  FROM mismatches;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'FA category weights do not match the generic scorecard (30/15/25/30): %',
      offending
      USING ERRCODE = '23514';
  END IF;

  WITH fa_totals AS (
    SELECT
      candidate.carrier_key,
      question->>'categoryKey' AS category_key,
      sum((question->>'weight')::integer) AS total
    FROM assurant_realignment_rulesets AS candidate
    CROSS JOIN LATERAL jsonb_array_elements(candidate.ruleset->'fa_questions')
      AS question
    GROUP BY candidate.carrier_key, question->>'categoryKey'
  )
  SELECT string_agg(candidate.carrier_key || ':' || (category->>'id'), ', ')
  INTO offending
  FROM assurant_realignment_rulesets AS candidate
  CROSS JOIN LATERAL jsonb_array_elements(candidate.ruleset->'scorecard_categories')
    AS category
  JOIN fa_totals
    ON fa_totals.carrier_key = candidate.carrier_key
   AND fa_totals.category_key = category->>'id'
  WHERE (category->>'max_score')::integer IS DISTINCT FROM fa_totals.total;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'FA scorecard category max_score does not equal its question weights: %',
      offending
      USING ERRCODE = '23514';
  END IF;

  WITH questions AS (
    SELECT candidate.carrier_key, question
    FROM assurant_realignment_rulesets AS candidate
    CROSS JOIN LATERAL jsonb_array_elements(
      (candidate.ruleset->'fa_questions') || (candidate.ruleset->'da_questions')
    ) AS question
  )
  SELECT string_agg(carrier_key, ', ')
  INTO offending
  FROM (
    SELECT carrier_key
    FROM questions
    GROUP BY carrier_key
    HAVING count(*) <> count(DISTINCT question->>'id')
  ) AS duplicated;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'An embedded carrier ruleset repeats a question id: %',
      offending
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(candidate.carrier_key || ':' || (question->>'id'), ', ')
  INTO offending
  FROM assurant_realignment_rulesets AS candidate
  CROSS JOIN LATERAL jsonb_array_elements(
    (candidate.ruleset->'fa_questions') || (candidate.ruleset->'da_questions')
  ) AS question
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(candidate.ruleset->'scorecard_categories')
      AS category
    WHERE category->>'id' = question->>'categoryKey'
  );

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'An embedded carrier ruleset question references an undeclared category: %',
      offending
      USING ERRCODE = '23514';
  END IF;
END
$ruleset_shape_preflight$;

-- Platform actor recorded as created_by/approved_by. Rehearsal fixtures may not
-- contain the account; production must, and it must be a platform admin.
CREATE TEMP TABLE assurant_realignment_actor (
  user_id varchar
) ON COMMIT DROP;

DO $actor_preflight$
DECLARE
  platform_actor_id constant varchar := 'bb69e426-5afa-481d-8c46-43a74ade5c64';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.id = platform_actor_id
      AND app_user.platform_role IS DISTINCT FROM
        'platform_admin'::public.platform_role
  ) THEN
    RAISE EXCEPTION
      'The platform actor % exists but is not a platform administrator',
      platform_actor_id
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO assurant_realignment_actor (user_id)
  SELECT app_user.id
  FROM public.users AS app_user
  WHERE app_user.id = platform_actor_id;

  IF NOT FOUND THEN
    RAISE NOTICE
      'Platform actor % is absent; ruleset provenance columns will be NULL',
      platform_actor_id;
    INSERT INTO assurant_realignment_actor (user_id) VALUES (NULL);
  END IF;
END
$actor_preflight$;

-- ---------------------------------------------------------------------------
-- Assurant tenant
-- ---------------------------------------------------------------------------
DO $assurant_identity_preflight$
DECLARE
  assurant_organization_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000004';
  assurant_profile_id constant uuid :=
    'c11c0000-0000-4000-8000-000000000004';
  assurant_entity_id constant uuid :=
    'e11e0000-0000-4000-8000-000000000007';
  assurant_version_id constant uuid :=
    'd11d0000-0000-4000-8000-000000000401';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = assurant_organization_id
      AND (
        name <> 'Assurant'
        OR slug <> 'assurant'
        OR is_default
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE slug = 'assurant'
      AND id <> assurant_organization_id
  ) THEN
    RAISE EXCEPTION
      'The Assurant organization identity collides with different data'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.carrier_rulesets AS profile
    WHERE (profile.id = assurant_profile_id OR profile.carrier_key = 'assurant')
      AND (
        profile.id <> assurant_profile_id
        OR profile.carrier_key <> 'assurant'
        OR profile.organization_id <> assurant_organization_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.carrier_rulesets AS profile
    WHERE profile.organization_id = assurant_organization_id
      AND profile.id <> assurant_profile_id
  ) THEN
    RAISE EXCEPTION
      'The Assurant carrier profile identity collides with different data'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.carrier_entities AS entity
    WHERE entity.id = assurant_entity_id
      AND (
        entity.organization_id <> assurant_organization_id
        OR entity.entity_key <> 'assurant'
        OR entity.display_name <> 'Assurant'
        OR entity.legal_name IS NOT NULL
        OR NOT entity.is_primary
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.carrier_entities AS entity
    WHERE entity.organization_id = assurant_organization_id
      AND entity.id <> assurant_entity_id
  ) THEN
    RAISE EXCEPTION
      'The Assurant carrier entity identity collides with different data'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.carrier_ruleset_versions AS version
    WHERE version.id = assurant_version_id
      AND (
        version.organization_id <> assurant_organization_id
        OR version.carrier_key <> 'assurant'
        OR version.version_number <> 1
        OR version.version_label <> '1.0'
        OR version.status <> 'published'::public.carrier_ruleset_version_state
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.carrier_ruleset_versions AS version
    WHERE (
        version.organization_id = assurant_organization_id
        OR version.carrier_key = 'assurant'
      )
      AND version.id <> assurant_version_id
  ) THEN
    RAISE EXCEPTION
      'The Assurant ruleset version history differs from the approved inventory'
      USING ERRCODE = '23505';
  END IF;
END
$assurant_identity_preflight$;

INSERT INTO public.organizations (
  id,
  name,
  slug,
  is_default,
  created_by_user_id
)
SELECT
  'a11a0000-0000-4000-8000-000000000004',
  'Assurant',
  'assurant',
  false,
  actor.user_id
FROM assurant_realignment_actor AS actor
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_settings (organization_id)
VALUES ('a11a0000-0000-4000-8000-000000000004')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO public.carrier_rulesets (
  id,
  organization_id,
  carrier_key,
  display_name,
  logo_url,
  active,
  ruleset
)
SELECT
  'c11c0000-0000-4000-8000-000000000004',
  'a11a0000-0000-4000-8000-000000000004',
  'assurant',
  'Assurant',
  NULL,
  true,
  candidate.ruleset
FROM assurant_realignment_rulesets AS candidate
WHERE candidate.carrier_key = 'assurant'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.carrier_entities (
  id,
  organization_id,
  entity_key,
  display_name,
  legal_name,
  is_primary,
  active
)
VALUES (
  'e11e0000-0000-4000-8000-000000000007',
  'a11a0000-0000-4000-8000-000000000004',
  'assurant',
  'Assurant',
  NULL,
  true,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.carrier_ruleset_versions (
  id,
  organization_id,
  carrier_key,
  version_number,
  version_label,
  status,
  display_name,
  logo_url,
  ruleset,
  validation,
  change_summary,
  source_references,
  created_by_user_id,
  approved_by_user_id,
  supersedes_version_id,
  created_at,
  published_at
)
SELECT
  'd11d0000-0000-4000-8000-000000000401',
  'a11a0000-0000-4000-8000-000000000004',
  'assurant',
  1,
  candidate.version_label,
  'published'::public.carrier_ruleset_version_state,
  'Assurant',
  NULL,
  candidate.ruleset,
  '{"errors":[],"warnings":[]}'::jsonb,
  'Initial Assurant ruleset. Field-adjuster checks are the atomic decomposition of the generic FA scorecard (Estimate Operational Order and Quality 30, Photographs Clear and In Order 15, FA Report 25, Unique Policy Provisions and Estimating Guidelines 30); policy checks are NOT_APPLICABLE when the policy is not in the file while the estimating-guidelines check always applies. Desk-adjuster checks are the seven generic DA questions.',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'label', 'Generic FA scorecard',
      'reference', 'docs/sample generic scorecard.xlsx'
    ),
    pg_catalog.jsonb_build_object(
      'label', 'Ruleset source',
      'reference', 'scripts/src/assurantRuleset.ts'
    )
  ),
  actor.user_id,
  actor.user_id,
  NULL,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
FROM assurant_realignment_rulesets AS candidate
CROSS JOIN assurant_realignment_actor AS actor
WHERE candidate.carrier_key = 'assurant'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Andover 2.0
-- ---------------------------------------------------------------------------
DO $andover_preflight$
DECLARE
  andover_organization_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000002';
  andover_version_2_id constant uuid :=
    'd11d0000-0000-4000-8000-000000000202';
  production_version_1_id constant uuid :=
    '058eeb00-036e-4378-8843-9fd922617d46';
  version_1 public.carrier_ruleset_versions%ROWTYPE;
  version_2 public.carrier_ruleset_versions%ROWTYPE;
  version_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = andover_organization_id
      AND slug = 'andover'
  ) THEN
    RAISE EXCEPTION
      'The Andover organization identity does not match the approved inventory'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM public.carrier_rulesets AS profile
    WHERE profile.organization_id = andover_organization_id
      AND profile.carrier_key = 'andover'
  ) <> 1
     OR (
       SELECT count(*)
       FROM public.carrier_entities AS entity
       WHERE entity.organization_id = andover_organization_id
         AND entity.is_primary
         AND entity.active
     ) <> 1 THEN
    RAISE EXCEPTION
      'The Andover carrier profile bundle differs from the approved inventory'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO version_count
  FROM public.carrier_ruleset_versions AS version
  WHERE version.organization_id = andover_organization_id
     OR version.carrier_key = 'andover';

  SELECT version.*
  INTO version_1
  FROM public.carrier_ruleset_versions AS version
  WHERE version.organization_id = andover_organization_id
    AND version.carrier_key = 'andover'
    AND version.version_number = 1;

  SELECT version.*
  INTO version_2
  FROM public.carrier_ruleset_versions AS version
  WHERE version.id = andover_version_2_id;

  IF version_1.id IS NULL THEN
    RAISE EXCEPTION
      'Andover ruleset version 1 is missing'
      USING ERRCODE = '23514';
  END IF;

  IF version_1.id <> production_version_1_id THEN
    RAISE NOTICE
      'Andover version 1 id % differs from the production inventory (%); continuing',
      version_1.id,
      production_version_1_id;
  END IF;

  IF version_2.id IS NULL THEN
    -- Fresh state: exactly one Andover version, and it is the published one.
    IF version_count <> 1
       OR version_1.status <> 'published'::public.carrier_ruleset_version_state
    THEN
      RAISE EXCEPTION
        'Andover ruleset version history differs from one published version 1 (found % versions, version 1 is %)',
        version_count,
        version_1.status
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Applied state: this migration already ran; verify it left the approved shape.
    IF version_count <> 2
       OR version_2.organization_id <> andover_organization_id
       OR version_2.carrier_key <> 'andover'
       OR version_2.version_number <> 2
       OR version_2.version_label <> '2.0'
       OR version_2.status <> 'published'::public.carrier_ruleset_version_state
       OR version_2.supersedes_version_id IS DISTINCT FROM version_1.id
       OR version_1.status <> 'archived'::public.carrier_ruleset_version_state
    THEN
      RAISE EXCEPTION
        'Andover ruleset version 2 exists but does not match the approved inventory'
        USING ERRCODE = '23505';
    END IF;
  END IF;
END
$andover_preflight$;

-- Archive the published version 1 (published -> archived is the only update the
-- history guard permits). This must precede the version 2 insert because only
-- one published version per carrier key is allowed.
UPDATE public.carrier_ruleset_versions AS version
SET status = 'archived'::public.carrier_ruleset_version_state
WHERE version.organization_id = 'a11a0000-0000-4000-8000-000000000002'
  AND version.carrier_key = 'andover'
  AND version.version_number = 1
  AND version.status = 'published'::public.carrier_ruleset_version_state;

INSERT INTO public.carrier_ruleset_versions (
  id,
  organization_id,
  carrier_key,
  version_number,
  version_label,
  status,
  display_name,
  logo_url,
  ruleset,
  validation,
  change_summary,
  source_references,
  created_by_user_id,
  approved_by_user_id,
  supersedes_version_id,
  created_at,
  published_at
)
SELECT
  'd11d0000-0000-4000-8000-000000000202',
  version_1.organization_id,
  version_1.carrier_key,
  2,
  candidate.version_label,
  'published'::public.carrier_ruleset_version_state,
  version_1.display_name,
  version_1.logo_url,
  candidate.ruleset,
  '{"errors":[],"warnings":[]}'::jsonb,
  'Realigned the field-adjuster categories to the generic scorecard weights (Estimate Operational Order 30, Photographs Clear and In Order 15, FA Report 25, Unique Policy Provisions 30; previously 20/20/30/30) and added the generic checks Andover lacked: no duplicate line items, overhead and profit applied correctly, FA report clarity and grammar, and carrier estimating-guideline compliance. All thirteen existing FA checks, all twenty-one DA checks, the DA weights, and the system prompt are unchanged from version '
    || version_1.version_label || '.',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'label', 'Generic FA scorecard',
      'reference', 'docs/sample generic scorecard.xlsx'
    ),
    pg_catalog.jsonb_build_object(
      'label', 'Ruleset source',
      'reference', 'scripts/src/andoverRuleset.ts'
    ),
    pg_catalog.jsonb_build_object(
      'label', 'Superseded Andover version ' || version_1.version_label,
      'reference', 'carrier_ruleset_versions/' || version_1.id::text
    )
  ),
  actor.user_id,
  actor.user_id,
  version_1.id,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
FROM public.carrier_ruleset_versions AS version_1
CROSS JOIN assurant_realignment_rulesets AS candidate
CROSS JOIN assurant_realignment_actor AS actor
WHERE version_1.organization_id = 'a11a0000-0000-4000-8000-000000000002'
  AND version_1.carrier_key = 'andover'
  AND version_1.version_number = 1
  AND candidate.carrier_key = 'andover'
ON CONFLICT (id) DO NOTHING;

-- Mirror private.platform_publish_carrier_ruleset_version: the profile carries
-- the published version's identity fields and ruleset.
UPDATE public.carrier_rulesets AS profile
SET
  display_name = version_2.display_name,
  logo_url = version_2.logo_url,
  ruleset = version_2.ruleset,
  active = true,
  updated_at = pg_catalog.clock_timestamp()
FROM public.carrier_ruleset_versions AS version_2
WHERE version_2.id = 'd11d0000-0000-4000-8000-000000000202'
  AND profile.organization_id = version_2.organization_id
  AND profile.carrier_key = version_2.carrier_key
  AND (
    profile.display_name IS DISTINCT FROM version_2.display_name
    OR profile.logo_url IS DISTINCT FROM version_2.logo_url
    OR profile.ruleset IS DISTINCT FROM version_2.ruleset
    OR NOT profile.active
  );

-- Fire the deferred profile-bundle constraint triggers now so a violation
-- surfaces here rather than at COMMIT.
SET CONSTRAINTS ALL IMMEDIATE;

DO $final_assertions$
DECLARE
  assurant_organization_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000004';
  assurant_profile_id constant uuid :=
    'c11c0000-0000-4000-8000-000000000004';
  assurant_entity_id constant uuid :=
    'e11e0000-0000-4000-8000-000000000007';
  assurant_version_id constant uuid :=
    'd11d0000-0000-4000-8000-000000000401';
  andover_organization_id constant uuid :=
    'a11a0000-0000-4000-8000-000000000002';
  andover_version_2_id constant uuid :=
    'd11d0000-0000-4000-8000-000000000202';
  offending text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = assurant_organization_id
      AND name = 'Assurant'
      AND slug = 'assurant'
      AND NOT is_default
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.organization_settings
    WHERE organization_id = assurant_organization_id
  ) THEN
    RAISE EXCEPTION
      'The Assurant organization was not created as specified'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM public.carrier_rulesets AS profile
    WHERE profile.organization_id = assurant_organization_id
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.carrier_rulesets AS profile
       JOIN assurant_realignment_rulesets AS candidate
         ON candidate.carrier_key = profile.carrier_key
       WHERE profile.id = assurant_profile_id
         AND profile.organization_id = assurant_organization_id
         AND profile.carrier_key = 'assurant'
         AND profile.display_name = 'Assurant'
         AND profile.active
         AND profile.ruleset = candidate.ruleset
     ) THEN
    RAISE EXCEPTION
      'The Assurant carrier profile was not created as specified'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM public.carrier_entities AS entity
    WHERE entity.organization_id = assurant_organization_id
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.carrier_entities AS entity
       WHERE entity.id = assurant_entity_id
         AND entity.organization_id = assurant_organization_id
         AND entity.entity_key = 'assurant'
         AND entity.display_name = 'Assurant'
         AND entity.legal_name IS NULL
         AND entity.is_primary
         AND entity.active
     ) THEN
    RAISE EXCEPTION
      'The Assurant primary carrier entity was not created as specified'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM public.carrier_ruleset_versions AS version
    WHERE version.organization_id = assurant_organization_id
  ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.carrier_ruleset_versions AS version
       JOIN assurant_realignment_rulesets AS candidate
         ON candidate.carrier_key = version.carrier_key
       WHERE version.id = assurant_version_id
         AND version.organization_id = assurant_organization_id
         AND version.carrier_key = 'assurant'
         AND version.version_number = 1
         AND version.version_label = '1.0'
         AND version.status = 'published'::public.carrier_ruleset_version_state
         AND version.published_at IS NOT NULL
         AND version.supersedes_version_id IS NULL
         AND version.ruleset = candidate.ruleset
     ) THEN
    RAISE EXCEPTION
      'The Assurant ruleset version 1.0 was not published as specified'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM public.carrier_ruleset_versions AS version
    WHERE version.organization_id = andover_organization_id
  ) <> 2
     OR (
       SELECT count(*)
       FROM public.carrier_ruleset_versions AS version
       WHERE version.organization_id = andover_organization_id
         AND version.status = 'published'::public.carrier_ruleset_version_state
     ) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.carrier_ruleset_versions AS version_2
       JOIN public.carrier_ruleset_versions AS version_1
         ON version_1.id = version_2.supersedes_version_id
       JOIN assurant_realignment_rulesets AS candidate
         ON candidate.carrier_key = version_2.carrier_key
       WHERE version_2.id = andover_version_2_id
         AND version_2.organization_id = andover_organization_id
         AND version_2.carrier_key = 'andover'
         AND version_2.version_number = 2
         AND version_2.version_label = '2.0'
         AND version_2.status = 'published'::public.carrier_ruleset_version_state
         AND version_2.published_at IS NOT NULL
         AND version_2.ruleset = candidate.ruleset
         AND version_2.display_name = version_1.display_name
         AND version_2.logo_url IS NOT DISTINCT FROM version_1.logo_url
         AND version_1.organization_id = andover_organization_id
         AND version_1.version_number = 1
         AND version_1.status = 'archived'::public.carrier_ruleset_version_state
     ) THEN
    RAISE EXCEPTION
      'The Andover ruleset version 2.0 was not published as specified'
      USING ERRCODE = '23514';
  END IF;

  -- Every configured tenant's profile must carry exactly its published ruleset.
  SELECT string_agg(profile.carrier_key, ', ')
  INTO offending
  FROM public.carrier_rulesets AS profile
  LEFT JOIN public.carrier_ruleset_versions AS published
    ON published.organization_id = profile.organization_id
   AND published.carrier_key = profile.carrier_key
   AND published.status = 'published'::public.carrier_ruleset_version_state
  WHERE profile.organization_id IN (assurant_organization_id, andover_organization_id)
    AND (
      published.id IS NULL
      OR profile.ruleset IS DISTINCT FROM published.ruleset
      OR profile.display_name IS DISTINCT FROM published.display_name
      OR profile.logo_url IS DISTINCT FROM published.logo_url
      OR NOT profile.active
    );

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Carrier profiles disagree with their published ruleset version: %',
      offending
      USING ERRCODE = '23514';
  END IF;

  -- The stored published rulesets carry the generic FA weights.
  WITH fa_totals AS (
    SELECT
      published.carrier_key,
      question->>'categoryKey' AS category_key,
      sum((question->>'weight')::integer) AS total
    FROM public.carrier_ruleset_versions AS published
    CROSS JOIN LATERAL jsonb_array_elements(published.ruleset->'fa_questions')
      AS question
    WHERE published.organization_id IN (assurant_organization_id, andover_organization_id)
      AND published.status = 'published'::public.carrier_ruleset_version_state
    GROUP BY published.carrier_key, question->>'categoryKey'
  ),
  expected (category_key, total) AS (
    VALUES
      ('fa_estimate_order', 30),
      ('fa_photo_quality', 15),
      ('fa_report', 25),
      ('fa_policy_provisions', 30)
  )
  SELECT string_agg(fa_totals.carrier_key || ':' || fa_totals.category_key, ', ')
  INTO offending
  FROM fa_totals
  LEFT JOIN expected ON expected.category_key = fa_totals.category_key
  WHERE expected.total IS DISTINCT FROM fa_totals.total;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Published FA category weights do not match the generic scorecard: %',
      offending
      USING ERRCODE = '23514';
  END IF;
END
$final_assertions$;

COMMIT;
