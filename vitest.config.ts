import { defineConfig } from "vitest/config";
import path from "path";

// Unit-test config. Keeps the runner Node-only (no jsdom) because everything
// under test here is backend: pure helpers, SQLite wrappers, zod schemas,
// Mastra glue. Component tests, if we ever add any, would move to a separate
// vitest workspace with jsdom.
//
// The `@/*` alias mirrors tsconfig.json so tests import with the same
// specifiers as app code.
export default defineConfig({
  test: {
    environment: "node",
    // Includes:
    //   - all unit tests under src/
    //   - scorer unit tests under evals/ (cheap, deterministic)
    // Eval RUNS (evals/*.eval.ts) hit real APIs and are triggered via the
    // dedicated `npm run evals` script, not vitest.
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    exclude: ["node_modules", "evals/**/*.eval.ts", ".next/**"],
    globals: false,
    clearMocks: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
