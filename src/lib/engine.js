// Matching orchestration (§4). Runs on activation: Stage 1 (free, deterministic)
// then a single batched Stage 2 AI call for everything that remains. The actual
// model call is injected as `complete(prompt) -> Promise<text>` so this stays
// pure and unit-testable; the content script wires it to the background worker.
import { stage1Match, buildMatchPrompt, parseMatchResponse } from "./matcher.js";

export async function runMatching({ fields, answerBank, threshold, complete }) {
  const { matches: stage1, unmatchedFieldIds } = stage1Match(fields, answerBank);

  const matchMap = new Map();
  for (const m of stage1) matchMap.set(m.fieldId, m);

  const unmatchedSet = new Set(unmatchedFieldIds);
  const unmatchedFields = fields.filter((f) => unmatchedSet.has(f.id));

  let stage2Error = null;
  if (unmatchedFields.length > 0 && typeof complete === "function") {
    const prompt = buildMatchPrompt({
      questions: unmatchedFields.map((f) => ({ id: f.id, label: f.label })),
      answerBank,
    });
    const text = await complete(prompt);
    const stage2 = parseMatchResponse(text, { threshold });
    for (const m of stage2) {
      if (!matchMap.has(m.fieldId)) {
        matchMap.set(m.fieldId, {
          fieldId: m.fieldId,
          entryId: m.entryId,
          confidence: m.confidence,
          source: "stage2",
        });
      }
    }
  }

  const bankById = new Map(answerBank.map((b) => [b.id, b]));
  const results = fields.map((field) => {
    const match = matchMap.get(field.id) || null;
    const entry = match ? bankById.get(match.entryId) || null : null;
    return {
      field,
      match: entry ? match : null,
      entry,
      status: entry ? "matched" : "unmatched",
    };
  });

  return { matchMap, results, stage2Error };
}
