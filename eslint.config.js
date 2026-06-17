// Minimal flat ESLint config (ESLint 9). Browser + service-worker globals for
// src, Node + Vitest globals for tests.
import js from "@eslint/js";

const browserGlobals = {
  chrome: "readonly",
  document: "readonly",
  window: "readonly",
  globalThis: "readonly",
  location: "readonly",
  CSS: "readonly",
  Event: "readonly",
  Worker: "readonly",
  HTMLInputElement: "readonly",
  HTMLTextAreaElement: "readonly",
  Blob: "readonly",
  URL: "readonly",
  TextEncoder: "readonly",
  Uint8Array: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
};

export default [
  { ignores: ["dist/**", "node_modules/**", "evals/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["test/**/*.js", "*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...browserGlobals,
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
