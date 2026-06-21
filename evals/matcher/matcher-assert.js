// Reusable assertion for the matcher eval. Parses the model's JSON mapping with
// the extension's own parser, then checks the predicted mapping equals the
// expected mapping declared on each test case (vars.expected).
//
// TODO_FILL_IN: decide whether to evaluate the RAW mapping (threshold 0, below)
// or the threshold-filtered mapping the extension would actually apply.
import { parseMatchResponse } from "../../src/lib/matcher.js";

export default function (output, context) {
  const expected = (context && context.vars && context.vars.expected) || {};
  const expectedOptions = (context && context.vars && context.vars.expected_options) || {};

  let predicted;
  try {
    predicted = parseMatchResponse(output, { threshold: 0 });
  } catch (e) {
    return { pass: false, score: 0, reason: `Output was not parseable JSON: ${e.message}` };
  }

  const predMap = Object.fromEntries(predicted.map((p) => [p.fieldId, p.entryId]));
  const predOptionMap = Object.fromEntries(predicted.map((p) => [p.fieldId, p.selectedOption ?? null]));

  const keys = new Set([...Object.keys(expected), ...Object.keys(predMap)]);
  const mismatches = [];
  for (const k of keys) {
    const exp = expected[k] == null ? null : expected[k];
    const got = predMap[k] == null ? null : predMap[k];
    if (exp !== got) mismatches.push(`${k}: expected ${exp}, got ${got}`);
  }

  for (const [k, expOpt] of Object.entries(expectedOptions)) {
    const gotOpt = predOptionMap[k] ?? null;
    if (expOpt !== gotOpt) mismatches.push(`${k} selected_option: expected "${expOpt}", got "${gotOpt}"`);
  }

  return mismatches.length === 0
    ? { pass: true, score: 1, reason: "mapping matches expected" }
    : { pass: false, score: 0, reason: `mismatches → ${mismatches.join("; ")}` };
}
