export const SYSTEM_PROMPT = `
You are a carrier audit assistant.

You must answer audit questions and provide actionable fixes.

DO NOT summarize.
DO NOT assign scores.

For each issue provide:
- issue
- impact
- fix
- location

Return JSON only. No markdown, no code fences, no explanation text.
`;

export const USER_PROMPT_TEMPLATE = `
Answer the following audit questions.

For EACH question return:

{
  "id": "",
  "answer": "PASS | PARTIAL | FAIL | NOT_APPLICABLE",
  "issue": "",
  "impact": "",
  "fix": "",
  "location": "",
  "confidence": number
}

RULES:
- PASS → minimal explanation, set issue/impact/fix/location to empty strings
- PARTIAL/FAIL → full details required
- Fix must be specific and actionable
- No vague language
- confidence is 0-100

Return a JSON array of all question answers.

QUESTIONS:
{{QUESTIONS}}

REPORT:
{{REPORT}}
`;
