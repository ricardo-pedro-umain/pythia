import { Mastra } from "@mastra/core";

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    'Missing required environment variable "OPENAI_API_KEY". Set it in .env.local or your deployment environment.'
  );
}
import { dataEngineerAgent } from "./agents/data-engineer";
import { financialAnalystAgent } from "./agents/financial-analyst";
import { brandMarketAgent } from "./agents/brand-market";
import { qaValidatorAgent } from "./agents/qa-validator";
import { reportAgent } from "./agents/report";
import { chatAgent } from "./agents/chat";
import { pythiaWorkflow } from "./workflows/pythia-analysis";

export const mastra = new Mastra({
  agents: {
    dataEngineerAgent,
    financialAnalystAgent,
    brandMarketAgent,
    qaValidatorAgent,
    reportAgent,
    chatAgent,
  },
  workflows: {
    pythiaWorkflow,
  },
});
