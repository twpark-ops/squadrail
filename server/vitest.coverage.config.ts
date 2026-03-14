import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import {
  SERVER_COVERAGE_EXCLUDE,
  SERVER_TEST_INCLUDE,
} from "./vitest.test-groups.js";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: SERVER_TEST_INCLUDE,
    fileParallelism: false,
    maxWorkers: 2,
    minWorkers: 1,
  },
  coverage: {
    enabled: true,
    provider: "v8",
    reporter: ["text-summary", "json-summary", "lcov"],
    include: ["src/**/*.ts"],
    exclude: SERVER_COVERAGE_EXCLUDE,
  },
});
