import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/e2e/__tests__/**/*.test.ts"],
  },
});
