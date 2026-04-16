import { createTool } from "@mastra/core/tools";
import { tavily } from "@tavily/core";
import { z } from "zod";

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export const webSearch = createTool({
  id: "web-search",
  description:
    "Search the web for information about a company, topic, or query. Returns relevant search results with URLs, titles, and content snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query to execute"),
    maxResults: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe("Maximum number of results to return"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        url: z.string(),
        title: z.string(),
        content: z.string(),
        score: z.number(),
      })
    ),
  }),
  execute: async (inputData) => {
    const response = await tavilyClient.search(inputData.query, {
      maxResults: inputData.maxResults,
      includeAnswer: false,
    });

    return {
      results: response.results.map((r) => ({
        url: r.url,
        title: r.title,
        content: r.content,
        score: r.score,
      })),
    };
  },
});
