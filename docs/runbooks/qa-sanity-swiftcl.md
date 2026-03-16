# QA Sanity Runbook: swiftcl

Project: swiftcl
Language: Go
Type: Workflow Compiler CLI + LSP
Workspace: ~/workspace/cloud-swiftsight/swiftcl

## Prerequisites

- Go 1.22+
- golangci-lint

## Sanity Steps

### 1. Build

```bash
cd ~/workspace/cloud-swiftsight/swiftcl
make build
```

Expected: `./bin/swiftcl` binary created, exit code 0.

### 2. Unit Tests (90% coverage threshold)

```bash
make test-coverage
```

Expected: all tests pass, coverage ≥ 90%.

### 3. Validate Example Workflows

```bash
make validate
```

Expected: all SwiftCL example files in `examples/` parse and validate without errors.

### 4. Plan Generation Smoke

```bash
./bin/swiftcl plan examples/basic/001-minimal-workflow.swiftcl
```

Expected: execution plan output, no errors.

### 5. Full CI Check

```bash
make ci
```

Expected: fmt + vet + lint + test-coverage + security all pass.

## Evidence to Record

- Build output (exit code)
- Test coverage percentage
- Validate output (example file count)
- Plan generation output
- CI check summary

## TODO: Integration + E2E Tests

> Integration tests (`make test-integration`) and E2E tests (`make test-e2e`) require
> additional setup. When ready: run full integration suite with tagged test files.
