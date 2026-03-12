import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  coverage: {
    provider: "v8",
    reporter: ["text-summary", "json-summary", "lcov"],
    include: ["src/**/*.ts"],
    exclude: [
      "src/**/*.d.ts",
      "src/**/__tests__/**",
      "src/index.ts",
    ],
  },
});
