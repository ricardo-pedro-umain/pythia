# Evals

Opt-in quality harness. Drives the full `pythiaWorkflow` against a small set
of known-company fixtures and scores the outputs with deterministic,
non-LLM checks.

## Why not vitest?

Unit tests run on every commit and must be fast, sandboxed, and cheap.
Evals hit the real Tavily + OpenAI APIs, take minutes per fixture, and
cost money. Keeping them as a separate script with its own entry point
means CI never accidentally burns through your API budget.

The *scorers themselves* are pure TypeScript and have a companion test
suite (`scorers.test.ts`) that runs in the regular `npm test` pass.

## Layout

```
evals/
  fixtures.ts         # Companies + loose expectations per fixture
  scorers.ts          # Pure scorers: schemaValid, sourcesCount, …
  scorers.test.ts     # Unit tests for the scorers (runs with `npm test`)
  run-evals.ts        # The actual runner — drives the workflow end-to-end
  reports/            # Auto-generated Markdown reports (gitignored)
```

## Running

```bash
# Full pass across every fixture
TAVILY_API_KEY=… OPENAI_API_KEY=… npm run evals

# Filter to specific fixtures by key
EVAL_FILTER=stripe,anthropic npm run evals

# Custom report path
EVAL_OUT=evals/reports/baseline.md npm run evals
```

The script writes a Markdown summary to `evals/reports/` and prints
per-scorer results live. Exit code is non-zero if any fixture fails the
hard `schemaValid` gate.

## Scorers

| Scorer | What it checks |
| --- | --- |
| `schemaValid` | All four structured outputs parse against their zod schemas. Hard gate. |
| `sourcesCount` | Data engineer retained enough sources (≥ 8 for famous, ≥ 3 for obscure). |
| `confidenceVariance` | Confidence values show healthy spread, not uniform filler. |
| `wellKnownBackfill` | Fixture-specific hints (founded year, HQ, competitors) show up. |
| `gracefulDegradation` | On obscure fixtures, output has low confidence + declared gaps. |
| `qaAlignment` | The QA validator's own quality score. |

Scorers return `{ name, score: [0,1], passed: boolean, details: string }`.
`passed` uses a scorer-specific threshold; the raw `score` is what you
track over time.

## Adding a new fixture

1. Add an entry to `FIXTURES` in `fixtures.ts`.
2. Choose an archetype (`famous`, `recently_funded`, `obscure`) — the
   `sourcesCount` and `gracefulDegradation` scorers branch on it.
3. Fill `expected` with soft hints. Omit what you can't confidently
   predict — the `wellKnownBackfill` scorer is neutral when nothing is
   configured.

## Adding a new scorer

1. Implement it in `scorers.ts` matching the `Scorer` signature.
2. Add it to the exported `SCORERS` array.
3. Add a unit test to `scorers.test.ts` covering its edge cases.
