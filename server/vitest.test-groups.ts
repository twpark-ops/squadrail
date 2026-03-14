export const SERVER_TEST_INCLUDE = ["src/**/*.test.ts"];

// These suites spin up larger route graphs, embedded services, or wide mocks.
// Run them in a dedicated serial pass to keep peak memory predictable.
export const SERVER_HEAVY_TESTS = [
  "src/__tests__/issues-routes.test.ts",
  "src/__tests__/issue-retrieval.test.ts",
  "src/__tests__/companies-routes.test.ts",
  "src/__tests__/knowledge-routes.test.ts",
  "src/__tests__/knowledge-routes-extended.test.ts",
  "src/__tests__/knowledge-service-operations.test.ts",
  "src/__tests__/issue-protocol-service.test.ts",
  "src/__tests__/issue-protocol-execution.test.ts",
  "src/__tests__/issue-retrieval-finalization.test.ts",
  "src/__tests__/heartbeat-service-flow.test.ts",
  "src/__tests__/team-blueprints-apply.test.ts",
  "src/__tests__/company-portability-service.test.ts",
  "src/__tests__/index-startup.test.ts",
];

export const SERVER_COVERAGE_EXCLUDE = [
  "src/**/*.d.ts",
  "src/**/__tests__/**",
  "src/index.ts",
];
