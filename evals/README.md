# Apply Assistant — Eval Harness (promptfoo)

Evals for the Stage-2 semantic matcher — the one LLM-dependent behavior where a
wrong answer silently fills a form field with the wrong value.

The eval **imports the extension's real prompt builder** (`../../src/lib/matcher.js`)
and scores with its real parser (`parseMatchResponse`). There is no second copy of
the prompt to keep in sync — change `src/lib/matcher.js` and the eval changes with
it.

## Setup

```bash
cd evals
npm install
cp .env.example .env     # then paste your key into .env
```

Or export it directly instead of using `.env`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # never commit this; .env is gitignored
```

## Run

```bash
npm run eval:matcher    # run the matcher suites
npm run view            # open the promptfoo results UI
```

Runs cost real tokens. The full suite is 5 cases / 56 questions against
`claude-haiku-4-5` — cents, not dollars.

## What's covered

`matcher/tests.yaml` holds five hand-verified suites. They are deliberately
weighted toward *not* matching, because a confident wrong fill is the failure mode
that matters:

| Suite | Shape | Guards |
|---|---|---|
| A | 15-entry bank, 4 questions | direct + semantic matching, one abstention |
| B | 15-entry bank, 13 questions | ambiguous wording (a sponsorship question that name-drops "work authorization") |
| C | 3-entry bank, 12 questions | abstention under a sparse bank, incl. a LinkedIn-vs-GitHub trap |
| D | 22-entry bank, 24 questions | over-matching — 22 should match, 2 must not |
| E | dropdowns, 3 questions | option-level matching (below) |

### Dropdown cases

A dropdown match requires **both** the question to match the bank entry *and* one
of the available options to accurately represent the stored answer. Suite E pins
all three outcomes:

1. Question and option both match → fill, with `selected_option` set verbatim.
2. Question matches but no option fits (bank says "Ph.D.", options stop at
   "Bachelors degree") → **no match**, because selecting the closest option would
   misrepresent the user.
3. An option's text resembles the stored answer but the question is about a
   different topic → **no match**.

## Adding cases

Each case sets the page questions, the answer bank (preselected answers by user), and the expected mapping:

```yaml
- description: sponsorship question maps to the sponsorship entry
  vars:
    page_questions: '[{"id":"q1","label":"Will you require visa sponsorship?"}]'
    answer_bank: '[{"id":"b1","label":"Require sponsorship?","answer":"No"}]'
    expected:
      q1: b1        # or `null` for "should not match"
```

For a dropdown question, add `options` to the question and assert the chosen
option text:

```yaml
    page_questions: '[{"id":"q1","label":"Employment type?","options":["Full-time","Contract"]}]'
    expected:
      q1: b1
    expected_options:
      q1: "Full-time"
```

`matcher-assert.js` parses the model's JSON with the extension's own
`parseMatchResponse`, then checks both the entry mapping and any expected option
texts. It evaluates the **raw** mapping (threshold 0) so a case failure points at
the prompt rather than at a threshold setting.

## Notes

- API keys come from the environment (`ANTHROPIC_API_KEY`); never commit them.
  `.env`, `evals/.env`, and `node_modules/` are gitignored at the repo root.
- `matcher/provider-v1.js` is a custom provider rather than promptfoo's built-in
  Anthropic one, so the eval can report token usage per case for cost comparison.
- An earlier `provider-v2.js` fanned out one call per question instead of batching.
  It needed a concurrency cap and inter-call delays to dodge rate limits, matched
  no more accurately, and cost significantly more — so it was removed. See the
  root README for the writeup.
