# QA Sanity Runbook: swiftsight-cloud

Project: swiftsight-cloud
Language: Go
Type: BFF Server (ConnectRPC + GraphQL + Temporal + RabbitMQ)
Workspace: ~/workspace/cloud-swiftsight/swiftsight-cloud

## Prerequisites

- Go 1.22+
- Docker Compose (PostgreSQL, Hasura, Temporal, RabbitMQ, MinIO)
- Proto/GraphQL codegen tools (buf, genqlient)

## Sanity Steps

### 1. Build

```bash
cd ~/workspace/cloud-swiftsight/swiftsight-cloud
make build
```

Expected: `./bin/server` binary created, exit code 0.

### 2. Unit Tests

```bash
make test
```

Expected: all tests pass. Note: race detector excluded for rabbitmq/util packages.

### 3. Start Dependencies

```bash
cd docker-compose
docker-compose up -d
```

Expected: PostgreSQL (5433), Hasura (9695), Temporal (7233/8088), RabbitMQ (5672/15672), MinIO (9000) all healthy.

### 4. Start Server

```bash
cd ~/workspace/cloud-swiftsight/swiftsight-cloud
./bin/server &
```

Expected: server starts on port 8080, logs show successful DB/Temporal/RabbitMQ connections.

### 5. Health Check

```bash
curl -sf http://localhost:8080/health
```

Expected: HTTP 200 response.

### 6. Dependency Health

```bash
# PostgreSQL
pg_isready -h localhost -p 5433

# RabbitMQ
curl -sf http://guest:guest@localhost:15672/api/overview | head -1

# Temporal
curl -sf http://localhost:8088 | head -1
```

Expected: all dependencies reachable.

### 7. Lint + Security

```bash
make check
```

Expected: golangci-lint + gosec pass.

### 8. Cleanup

```bash
kill %1
cd docker-compose && docker-compose down
```

## Evidence to Record

- Build output (exit code)
- Test output (pass count)
- Health check response
- Dependency health status
- Lint/security output

## TODO: API Smoke Testing

> ConnectRPC/GraphQL endpoint smoke is deferred.
> When ready: ClinicalService read, SettingsService CRUD, workflow trigger via TemporalService.
