// Adapter registry: pick the most specific ATS adapter for a host, falling back
// to the base adapter. Add Greenhouse/Lever/Ashby adapters here later.
import { BaseAdapter } from "./base.js";
import { WorkdayAdapter } from "./workday.js";

const ADAPTERS = [WorkdayAdapter];

export function getAdapter(host = typeof location !== "undefined" ? location.hostname : "") {
  const Match = ADAPTERS.find((A) => A.matches(host));
  return Match ? new Match() : new BaseAdapter();
}
