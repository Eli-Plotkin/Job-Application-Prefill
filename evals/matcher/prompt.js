// Matcher eval prompt — the SINGLE SOURCE OF TRUTH is the extension itself.
// This imports the exact Stage-2 prompt the extension sends (src/lib/matcher.js)
// so the eval can never drift from production. Do not duplicate the prompt text
// here.
import { buildMatchPrompt } from "../../src/lib/matcher.js";

// promptfoo calls this with { vars } and expects a chat-format messages array.
// vars.page_questions and vars.answer_bank are JSON strings (see tests.yaml).
export default function ({ vars }) {
  const questions = JSON.parse(vars.page_questions);
  const answerBank = JSON.parse(vars.answer_bank);
  const { system, user } = buildMatchPrompt({ questions, answerBank });
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
