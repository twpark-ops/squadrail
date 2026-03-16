# QA Sanity Runbook: swiftsight-agent

Project: swiftsight-agent
Language: Go
Type: DICOM Gateway Agent (gRPC client + StoreSCP + HTTP health)
Workspace: ~/workspace/cloud-swiftsight/swiftsight-agent

## Prerequisites

- Go 1.22+
- Docker (for MinIO dependency)
- config/agent.yaml present

## Sanity Steps

### 1. Build

```bash
cd ~/workspace/cloud-swiftsight/swiftsight-agent
make build
```

Expected: `./bin/swiftsight-gateway` binary created, exit code 0.

### 2. Unit Tests

```bash
make test
```

Expected: all tests pass. Note: runs with `-p 1` (sequential) to avoid OOM.

### 3. Start Service

```bash
docker-compose up -d minio   # MinIO dependency
./bin/swiftsight-gateway --config config/agent.yaml &
```

Expected: process starts without panic, logs show initialization.

### 4. Health Check

```bash
curl -sf http://localhost:8080/health
```

Expected: HTTP 200 response.

### 5. Lint + Security

```bash
make check
```

Expected: golangci-lint + gosec pass with no HIGH/CRITICAL findings.

### 6. Cleanup

```bash
kill %1                       # stop gateway
docker-compose down           # stop MinIO
```

## Evidence to Record

- Build output (exit code)
- Test output (pass count, failures if any)
- Health check response
- Lint/security output

## TODO: DICOM Fixture Testing

> DICOM ingest path verification is deferred.
> When ready, use fixtures from `~/workspace/cloud-swiftsight/dicom_sample/`.
> Steps will include: StoreSCP listener → send DICOM via storescu → verify ingest log + S3 upload.
