#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
// Evals runner — opt-in, network- and money-heavy.
//
// For each fixture:
//   1. Spin up an analysis row (same codepath as /api/analyze)
//   2. Drive the full pythiaWorkflow to completion
//   3. Load the final state from the store
//   4. Apply every scorer and collect results
// Then write a Markdown report summarising per-fixture and overall scores.
//
// Usage:
//   TAVILY_API_KEY=… OPENAI_API_KEY=… npm run evals
//
// Optional:
//   EVAL_FILTER=stripe,anthropic   # only run matching fixture keys
//   EVAL_OUT=evals/reports/run.md  # override report path
//
// This file is .ts and runs under `tsx` (added to devDependencies).
// Requires real API keys — there is no mock fallback; the whole point is to
// catch regressions in the actual model outputs.

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { mastra } from "@/mastra";
import { createAnalysis, getAnalysis } from "@/lib/store";
import type { PythiaAnalysisState } from "@/lib/types";
import { FIXTURES, type EvalFixture } from "./fixtures";
import { runAllScorers, type ScorerResult } from "./scorers";

// ----- filters ------------------------------------------------------------

function selectedFixtures(): EvalFixture[] {
  const filter = process.env.EVAL_FILTER;
  if (!filter) return FIXTURES;
  const keys = new Set(filter.split(",").map((s) => s.trim()).filter(Boolean));
  return FIXTURES.filter((f) => keys.has(f.key));
}

// ----- one run ------------------------------------------------------------

interface FixtureRun {
  fixture: EvalFixture;
  analysisId: string;
  durationMs: number;
  error: string | null;
  state: PythiaAnalysisState | null;
  scores: ScorerResult[];
}

async function runOne(fixture: EvalFixture): Promise<FixtureRun> {
  const analysisId = randomUUID();
  const start = Date.now();

  createAnalysis(analysisId, fixture.companyName, fixture.inputUrl);

  const workflow = mastra.getWorkflow("pythiaWorkflow");
  try {
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        companyName: fixture.companyName,
        url: fixture.inputUrl,
        analysisId,
      },
    });

    if (result.status !== "success") {
      const errorMsg =
        result.status === "failed"
          ? (result as { error: Error }).error.message
          : result.status;
      return {
        fixture,
        analysisId,
        durationMs: Date.now() - start,
        error: errorMsg,
        state: getAnalysis(analysisId) ?? null,
        scores: [],
      };
    }
  } catch (err) {
    return {
      fixture,
      analysisId,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      state: getAnalysis(analysisId) ?? null,
      scores: [],
    };
  }

  const state = getAnalysis(analysisId);
  if (!state) {
    return {
      fixture,
      analysisId,
      durationMs: Date.now() - start,
      error: "analysis row vanished after workflow completion",
      state: null,
      scores: [],
    };
  }

  const scores = runAllScorers(state, fixture);
  return {
    fixture,
    analysisId,
    durationMs: Date.now() - start,
    error: null,
    state,
    scores,
  };
}

// ----- report -------------------------------------------------------------

function formatDuration(ms: number): string {
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

function renderReport(runs: FixtureRun[]): string {
  const lines: string[] = [];
  lines.push(`# Pythia Evals — ${new Date().toISOString()}\n`);
  lines.push(`Fixtures: ${runs.length}\n`);

  // Aggregate
  const allScores = runs.flatMap((r) => r.scores);
  const meanByName = new Map<string, { sum: number; n: number; pass: number }>();
  for (const s of allScores) {
    const agg = meanByName.get(s.name) ?? { sum: 0, n: 0, pass: 0 };
    agg.sum += s.score;
    agg.n += 1;
    agg.pass += s.passed ? 1 : 0;
    meanByName.set(s.name, agg);
  }

  lines.push(`## Summary\n`);
  lines.push(`| Scorer | Mean score | Pass rate |`);
  lines.push(`| --- | --- | --- |`);
  for (const [name, agg] of meanByName) {
    const mean = agg.n > 0 ? agg.sum / agg.n : 0;
    lines.push(
      `| ${name} | ${mean.toFixed(2)} | ${agg.pass}/${agg.n} |`
    );
  }
  lines.push("");

  // Per-fixture detail
  for (const run of runs) {
    lines.push(
      `## ${run.fixture.companyName} — ${run.fixture.archetype} (${formatDuration(run.durationMs)})`
    );
    if (run.error) {
      lines.push(`**ERROR**: ${run.error}\n`);
      continue;
    }
    lines.push("");
    lines.push(`| Scorer | Score | Pass | Details |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const s of run.scores) {
      lines.push(
        `| ${s.name} | ${s.score.toFixed(2)} | ${s.passed ? "✅" : "❌"} | ${s.details} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ----- main ---------------------------------------------------------------

async function main() {
  const fixtures = selectedFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures matched the filter. Exiting.");
    process.exit(1);
  }

  console.log(
    `Running ${fixtures.length} fixture(s): ${fixtures.map((f) => f.key).join(", ")}`
  );

  const runs: FixtureRun[] = [];
  for (const f of fixtures) {
    console.log(`\n→ ${f.companyName} (${f.archetype})`);
    const run = await runOne(f);
    if (run.error) {
      console.error(`  ✗ ${run.error}`);
    } else {
      for (const s of run.scores) {
        console.log(
          `  ${s.passed ? "✓" : "✗"} ${s.name.padEnd(22)} ${s.score.toFixed(2)}  ${s.details}`
        );
      }
    }
    runs.push(run);
  }

  const outPath =
    process.env.EVAL_OUT ??
    path.join(
      "evals",
      "reports",
      `run-${new Date().toISOString().replace(/[:.]/g, "-")}.md`
    );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderReport(runs), "utf8");
  console.log(`\nReport written to ${outPath}`);

  // Exit non-zero if any fixture errored or any required scorer failed.
  // schemaValid is the only hard gate — every other scorer is a signal.
  const anySchemaFail = runs.some((r) =>
    r.error ? true : r.scores.some((s) => s.name === "schemaValid" && !s.passed)
  );
  process.exit(anySchemaFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
