import { describe, it, expect } from "vitest";
import { humanError } from "../src/lib/errors.js";

describe("humanError", () => {
  it("passes through an unrecognized message unchanged", () => {
    expect(humanError(new Error("boom"))).toBe("boom");
  });

  it("accepts a plain string in place of an Error", () => {
    expect(humanError("boom")).toBe("boom");
  });

  it("rewrites a missing API key", () => {
    expect(humanError(new Error("No API key set."))).toMatch(/Open the Apply Assistant dashboard/);
  });

  it("rewrites a 401 authentication failure", () => {
    expect(humanError(new Error('401 {"type":"authentication_error","message":"invalid x-api-key"}'))).toMatch(
      /rejected/,
    );
  });

  it("rewrites a 429 rate limit", () => {
    expect(humanError(new Error("429 rate_limit_error"))).toMatch(/rate-limiting/);
  });

  it("rewrites a 5xx server error", () => {
    expect(humanError(new Error("529 overloaded_error"))).toMatch(/temporarily unavailable/);
  });

  it("rewrites a network failure", () => {
    expect(humanError(new Error("Failed to fetch"))).toMatch(/Couldn't reach the Anthropic API/);
  });

  it("rewrites a malformed matcher JSON response", () => {
    expect(humanError(new Error("No JSON object found in matcher response"))).toMatch(
      /unreadable response from the AI model/,
    );
    expect(humanError(new Error("Unexpected token o in JSON at position 4"))).toMatch(
      /unreadable response from the AI model/,
    );
  });

  it("rewrites a dropped extension connection", () => {
    expect(humanError(new Error("No response from the background worker."))).toMatch(
      /Lost connection to the extension/,
    );
  });

  it("rewrites a password-protected PDF", () => {
    expect(humanError(new Error("The PDF is encrypted and requires a password."))).toMatch(
      /password-protected/,
    );
  });
});
