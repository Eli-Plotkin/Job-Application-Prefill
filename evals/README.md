# Apply Assistant — Eval Harness (promptfoo)

Evals for the two LLM-dependent behaviors:

- **Matcher** (`matcher/`) — the Stage-2 semantic match prompt (spec §4).
- **Drafter** (`drafter/`) — the Write-with-AI prompt (spec §5).

The eval prompts **import the extension's real prompt builders** (`../../src/lib/matcher.js`, `../../src/lib/drafter.js`), so they can never drift from what the extension actually sends. There is no second copy of the prompt to keep in sync — change `src/lib/*.js` and the eval changes with it.

## Setup

```bash
cd evals
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # never commit this; .env is gitignored
```

## Run

```bash
npm run eval            # both suites
npm run eval:matcher    # matcher only
npm run eval:drafter    # drafter only
npm run view            # open the promptfoo results UI
```

The scaffold ships with **placeholder cases only**. They run, but fail until you
fill in real data — that's expected. Filling them is your job (the spec is
explicit that eval data must be hand-verified, not invented).

## Adding cases

### Matcher (`matcher/tests.yaml`)

Each case sets three vars and an expected mapping:

```yaml
- description: sponsorship question maps to the sponsorship entry
  vars:
    page_questions: '[{"id":"q1","label":"Will you require visa sponsorship?"}]'
    answer_bank: '[{"id":"b1","label":"Require sponsorship?","answer":"No"}]'
    expected:
      q1: b1        # or `null` for "should not match"
```

`matcher-assert.js` parses the model's JSON with the extension's own
`parseMatchResponse` and checks the predicted mapping equals `expected`.

Three shapes to cover (commented skeletons are in `tests.yaml`):
1. a differently-worded question that **should** map,
2. an unrelated question that **must** map to `null` (guards confident-but-wrong),
3. a case with **no** matches at all (guards the Stage-1/Stage-2 boundary).

### Drafter (`drafter/tests.yaml`)

Each case provides `question`, `resume_text`, `blurb` (and `previous_draft` +
`guidance` for rewrite cases). Assertions in `drafter/promptfooconfig.yaml` check
first-person voice, that the answer addresses the question, length, and — most
importantly — **no fabrication** of facts absent from the resume/blurb (spec
§13.3). Add per-case `assert:` blocks for case-specific expectations.

## Notes

- API keys come from the environment (`ANTHROPIC_API_KEY`); never commit them.
  `.env`, `evals/.env`, and `node_modules/` are gitignored at the repo root.
- Default models: `claude-haiku-4-5` (matcher), `claude-sonnet-4-6` (drafter).
  Uncomment the second provider in `matcher/promptfooconfig.yaml` to compare two
  models side by side.
- `llm-rubric` assertions are model-graded; tune the rubric wording as you learn
  what trips false pass/fails.
