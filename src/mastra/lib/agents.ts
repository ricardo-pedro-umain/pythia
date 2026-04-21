// Typed accessors for Mastra agents.
//
// `mastra.getAgent("dataEngineerAgent")` is stringly-typed — a typo compiles
// fine and blows up at runtime. Wrapping each call in a dedicated getter
// gives us:
//   - autocomplete when writing new workflow steps
//   - a single place to rename an agent if we ever refactor the registry
//   - compile-time breakage if the registry shape drifts
//
// The `Mastra` parameter is injected so this file doesn't import the
// registry and create a circular dep with workflows.

import type { Mastra } from "@mastra/core";

export const AGENT_IDS = {
  dataEngineer: "dataEngineerAgent",
  financialAnalyst: "financialAnalystAgent",
  brandMarket: "brandMarketAgent",
  qaValidator: "qaValidatorAgent",
  report: "reportAgent",
  chat: "chatAgent",
} as const;

export type AgentKey = keyof typeof AGENT_IDS;

export function getAgent(mastra: Mastra, key: AgentKey) {
  return mastra.getAgent(AGENT_IDS[key]);
}
