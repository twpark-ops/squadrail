# QA Sanity Runbook: swiftsight-report-server

Project: swiftsight-report-server
Language: Python 3.11
Type: Report Generation RPC Server (RabbitMQ consumer)
Workspace: ~/workspace/cloud-swiftsight/swiftsight-report-server

## Prerequisites

- Docker
- RabbitMQ running (for production mode)

## Sanity Steps

### 1. Build Docker Image

```bash
cd ~/workspace/cloud-swiftsight/swiftsight-report-server
docker build -t swiftsight-report-server .
```

Expected: image built successfully, exit code 0.

### 2. Dry-Run Test

```bash
docker run --rm swiftsight-report-server python3 -m swiftsight_report_server --dry-run
```

Expected: initialization completes without error, normative DB loaded, exits cleanly.

### 3. Local Test

```bash
python test_total.py
```

Expected: report generation test passes without RabbitMQ dependency.

### 4. Start Container (Consumer Mode)

```bash
docker run -d --name report-server \
  -e RABBITMQ_URL="amqp://swiftsight:password@host.docker.internal:5672/" \
  swiftsight-report-server
```

Expected: container starts, connects to RabbitMQ, listens on queue `swiftsight.report.request`.

### 5. Container Health

```bash
docker exec report-server pgrep -f "swiftsight_report_server"
```

Expected: process ID returned (alive).

### 6. Cleanup

```bash
docker stop report-server && docker rm report-server
```

## Evidence to Record

- Docker build output
- Dry-run output (initialization log)
- test_total.py output
- Container health check result

## TODO: Report Generation E2E

> Full report generation with sample data is deferred.
> When ready: send report request via RabbitMQ → verify PDF/artifact output.
> Report types: brain_atrophy_patient, brain_atrophy_physician, brain_epilepsy_physician, brain_tbi_physician.
