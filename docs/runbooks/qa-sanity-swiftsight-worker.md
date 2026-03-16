# QA Sanity Runbook: swiftsight-worker

Project: swiftsight-worker
Language: Python 3.11
Type: AI Analysis Workers (brain-volumetry, brain-wmh2d, brain-wmh3d)
Workspace: ~/workspace/cloud-swiftsight/swiftsight-worker

## Prerequisites

- Docker + Docker Compose
- RabbitMQ running (from swiftsight-cloud docker-compose or standalone)

## Sanity Steps

### 1. Build Docker Images

```bash
cd ~/workspace/cloud-swiftsight/swiftsight-worker
make docker-build
```

Expected: 3 images built (volumetry, wmh2d, wmh3d), exit code 0.

### 2. Start Workers

```bash
make docker-up
```

Expected: all 3 worker containers start and connect to RabbitMQ.

### 3. Container Health

```bash
docker ps --filter "name=swiftsight-worker" --format "{{.Names}}\t{{.Status}}"
```

Expected: all containers show "Up" status.

### 4. RabbitMQ Queue Binding

```bash
curl -sf http://guest:guest@localhost:15672/api/queues | python3 -c "
import sys, json
queues = json.load(sys.stdin)
worker_queues = [q['name'] for q in queues if 'swiftsight' in q.get('name','')]
print('\n'.join(worker_queues))
"
```

Expected: worker queues registered and bound.

### 5. Cleanup

```bash
make docker-down
```

## Evidence to Record

- Docker build output (per worker)
- Container status
- RabbitMQ queue binding confirmation

## TODO: AI Model Inference Testing

> Model loading and inference sanity is deferred.
> When ready: send sample MRI data via RabbitMQ → verify volumetry/WMH result artifact.
