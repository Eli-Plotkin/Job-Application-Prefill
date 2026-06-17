// Vitest setup: provide a minimal in-memory `chrome` API stub for tests that
// touch chrome.storage / chrome.runtime. Individual tests can override pieces.
import { vi } from "vitest";

function createStorageArea() {
  let store = {};
  return {
    get: vi.fn(async (keys) => {
      if (keys == null) return { ...store };
      if (typeof keys === "string") {
        return keys in store ? { [keys]: store[keys] } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (k in store) out[k] = store[k];
        return out;
      }
      // object with defaults
      const out = {};
      for (const [k, def] of Object.entries(keys)) {
        out[k] = k in store ? store[k] : def;
      }
      return out;
    }),
    set: vi.fn(async (items) => {
      Object.assign(store, items);
    }),
    remove: vi.fn(async (keys) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete store[k];
    }),
    clear: vi.fn(async () => {
      store = {};
    }),
    // test helper
    __dump: () => ({ ...store }),
  };
}

globalThis.chrome = {
  storage: {
    local: createStorageArea(),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    lastError: null,
  },
};
