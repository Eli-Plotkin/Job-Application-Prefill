// Drafter eval prompt — imports the exact Write-with-AI prompt the extension
// sends (src/lib/drafter.js) so the eval stays in lockstep with production.
//
// vars: question, resume_text, blurb, and (for rewrite cases) previous_draft + guidance.
import { buildDraftPrompt, buildRewritePrompt } from "../../src/lib/drafter.js";

export default function ({ vars }) {
  const base = {
    question: vars.question,
    resumeText: vars.resume_text,
    blurb: vars.blurb,
  };
  const { system, user } = vars.previous_draft
    ? buildRewritePrompt({ ...base, previousDraft: vars.previous_draft, guidance: vars.guidance || "" })
    : buildDraftPrompt(base);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
