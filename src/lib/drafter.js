// "Write with AI" prompt construction (§5).
//
// Sends the specific question + resume text + about-me blurb, constraining the
// model to answer in the first person, concisely, truthfully, in the user's
// voice — and to never fabricate facts not supported by the resume/blurb.
//
// KEEP IN SYNC with evals/drafter/prompt.js — that eval validates this exact prompt.

const DRAFT_SYSTEM_PROMPT = `You help a job applicant draft answers to application questions in their own voice.

Rules:
- Write in the first person, as the applicant ("I ...").
- Be concise and specific — a few sentences, not an essay, unless the question clearly demands more.
- Use ONLY facts supported by the applicant's resume and about-me blurb. Do not make up employers, projects, dates, metrics, skills, or experiences that are not present in that context. If the question asks for something the context does not support, write a truthful answer in general terms rather than inventing details.
- Match the tone and positioning of the about-me blurb — it is the applicant's own voice.
- Output only the answer text itself. Do not add a preamble, a sign-off, quotation marks, or commentary.`;

function contextBlock({ resumeText, blurb }) {
  return `RESUME (extracted text):
"""
${resumeText || "(none provided)"}
"""

ABOUT ME (the applicant's own words):
"""
${blurb || "(none provided)"}
"""`;
}

// First-draft prompt. Returns { system, user }.
export function buildDraftPrompt({ question, resumeText, blurb }) {
  const user = `${contextBlock({ resumeText, blurb })}

QUESTION:
${question}

Write the applicant's answer now.`;
  return { system: DRAFT_SYSTEM_PROMPT, user };
}

// Rewrite prompt. Always includes the previous draft as context so the model
// revises it rather than starting from scratch; guidance is optional.
export function buildRewritePrompt({ question, resumeText, blurb, previousDraft, guidance }) {
  const guidanceLine = guidance && guidance.trim()
    ? `The applicant's guidance for this revision:
${guidance.trim()}`
    : `The applicant gave no specific guidance — produce an improved alternative draft.`;

  const user = `${contextBlock({ resumeText, blurb })}

QUESTION:
${question}

PREVIOUS DRAFT:
"""
${previousDraft}
"""

${guidanceLine}

Revise the previous draft accordingly. Output only the revised answer.`;
  return { system: DRAFT_SYSTEM_PROMPT, user };
}
