import { describe, it, expect, beforeEach } from "vitest";
import { getSpendLog, recordSpend } from "../src/lib/storage.js";

beforeEach(async () => {
  await chrome.storage.local.clear();
});

describe("spend log", () => {
  it("starts at zero with the current week and no unpriced calls", async () => {
    const log = await getSpendLog();
    expect(log.lifetimeUsd).toBe(0);
    expect(log.weeklyUsd).toBe(0);
    expect(log.unpricedCalls).toBe(0);
    expect(log.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accumulates into both lifetime and weekly totals", async () => {
    await recordSpend({ usd: 0.01 });
    await recordSpend({ usd: 0.02 });
    const log = await getSpendLog();
    expect(log.lifetimeUsd).toBeCloseTo(0.03, 10);
    expect(log.weeklyUsd).toBeCloseTo(0.03, 10);
  });

  it("does not lose writes when calls overlap", async () => {
    // The bug this guards: recordSpend is read-modify-write, so concurrent
    // callers reading the same baseline would clobber each other's totals.
    await Promise.all(Array.from({ length: 20 }, () => recordSpend({ usd: 0.5 })));
    const log = await getSpendLog();
    expect(log.lifetimeUsd).toBeCloseTo(10, 10);
    expect(log.weeklyUsd).toBeCloseTo(10, 10);
  });

  it("resets the weekly total when the stored week has rolled over, keeping lifetime", async () => {
    await chrome.storage.local.set({
      spendLog: { lifetimeUsd: 5, weeklyUsd: 5, weekStart: "2000-01-02", unpricedCalls: 0 },
    });
    await recordSpend({ usd: 1 });
    const log = await getSpendLog();
    expect(log.weeklyUsd).toBeCloseTo(1, 10); // stale week discarded
    expect(log.lifetimeUsd).toBeCloseTo(6, 10); // lifetime carries forward
  });

  it("counts unpriced calls without adding to the totals", async () => {
    await recordSpend({ usd: 0, priced: false });
    await recordSpend({ usd: 0, priced: false });
    const log = await getSpendLog();
    expect(log.unpricedCalls).toBe(2);
    expect(log.lifetimeUsd).toBe(0);
  });

  it("keeps counting after a failed write instead of stalling the queue", async () => {
    const realSet = chrome.storage.local.set;
    chrome.storage.local.set = () => Promise.reject(new Error("quota exceeded"));
    await expect(recordSpend({ usd: 1 })).rejects.toThrow("quota exceeded");

    chrome.storage.local.set = realSet;
    await recordSpend({ usd: 2 });
    expect((await getSpendLog()).lifetimeUsd).toBeCloseTo(2, 10);
  });
});
