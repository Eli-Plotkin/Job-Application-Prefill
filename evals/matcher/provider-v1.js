// Custom promptfoo provider for the v1 batched matcher eval.
// Fires a single Anthropic call with all questions batched into one prompt,
// then returns tokenUsage so it can be compared directly against v2.
import Anthropic from "@anthropic-ai/sdk";
import { buildMatchPrompt } from "../../src/lib/matcher.js";

const MODEL = process.env.PROMPTFOO_MATCHER_MODEL || "claude-haiku-4-5-20251001";

export default class MatcherV1Provider {
  id() {
    return "matcher-v1";
  }

  async callApi(_prompt, context) {
    const questions = JSON.parse(context.vars.page_questions);
    const answerBank = JSON.parse(context.vars.answer_bank);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { system, user } = buildMatchPrompt({ questions, answerBank });

    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    });

    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      output: text,
      tokenUsage: {
        total: resp.usage.input_tokens + resp.usage.output_tokens,
        prompt: resp.usage.input_tokens,
        completion: resp.usage.output_tokens,
      },
    };
  }
}
