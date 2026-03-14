import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import {
  SERVER_COVERAGE_EXCLUDE,
  SERVER_HEAVY_TESTS,
} from "./vitest.test-groups.js";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: SERVER_HEAVY_TESTS,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
  coverage: {
    provider: "v8",
    reporter: ["text-summary", "json-summary", "lcov"],
    include: ["src/**/*.ts"],
    exclude: SERVER_COVERAGE_EXCLUDE,
  },
});
