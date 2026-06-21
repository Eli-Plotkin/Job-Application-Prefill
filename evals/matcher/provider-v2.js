// Custom promptfoo provider for the v2 per-question matcher eval.
// For each test case it fires one Anthropic call per question in parallel,
// then returns the aggregated result in the same {"matches":[...]} shape as
// v1 so that matcher-assert.js can be shared between both evals unchanged.
import Anthropic from "@anthropic-ai/sdk";
import { buildMatchPromptV2, parseMatchResponseV2 } from "../../src/lib/matcher.js";

const MODEL = process.env.PROMPTFOO_MATCHER_MODEL || "claude-haiku-4-5-20251001";
const CONCURRENCY = 3;
const DELAY_MS = 300;

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Run `fn` over `items` with at most `concurrency` in-flight at once.
async function withConcurrency(items, fn, concurrency) {
  const results = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));
  async function worker() {
    while (queue.length > 0) {
      const { item, i } = queue.shift();
      results[i] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export default class MatcherV2Provider {
  id() {
    return "matcher-v2";
  }

  async callApi(_prompt, context) {
    const questions = JSON.parse(context.vars.page_questions);
    const answerBank = JSON.parse(context.vars.answer_bank);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const perQuestionMatches = await withConcurrency(
      questions,
      async (q) => {
        await delay(DELAY_MS);
        const { system, user } = buildMatchPromptV2({ question: q, answerBank });
        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: 256,
          system,
          messages: [{ role: "user", content: user }],
        });
        totalPromptTokens += resp.usage.input_tokens;
        totalCompletionTokens += resp.usage.output_tokens;
        const text = resp.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const match = parseMatchResponseV2(text, { fieldId: q.id, threshold: 0 });
        return {
          question_id: q.id,
          bank_entry_id: match ? match.entryId : null,
          confidence: match ? match.confidence : 0,
          selected_option: match ? match.selectedOption : null,
        };
      },
      CONCURRENCY
    );

    return {
      output: JSON.stringify({ matches: perQuestionMatches }),
      tokenUsage: {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
      },
    };
  }
}
