---
title: HTTP Adapter
summary: HTTP webhook adapter
---

The `http` adapter sends a webhook request to an external agent service. It remains available as a legacy compatibility adapter for externally hosted agent runtimes.

## When to Use

- Agent runs as an external service (cloud function, dedicated server)
- Fire-and-forget invocation model
- Integration with third-party agent platforms

## When Not to Use

- If the agent runs locally on the same machine (use `process`, `claude_local`, or `codex_local`)
- If you need stdout capture and real-time run viewing

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Webhook URL to POST to |
| `headers` | object | No | Additional HTTP headers |
| `timeoutSec` | number | No | Request timeout |

## How It Works

1. Squadrail sends a POST request to the configured URL
2. The request body includes the execution context (agent ID, task info, wake reason)
3. The external agent processes the request and calls back to the Squadrail API
4. Response from the webhook is captured as the run result

## Request Body

The webhook receives a JSON payload with:

```json
{
  "runId": "...",
  "agentId": "...",
  "companyId": "...",
  "context": {
    "taskId": "...",
    "wakeReason": "...",
    "commentId": "..."
  }
}
```

The external agent uses `SQUADRAIL_API_URL` and an API key to call back to Squadrail.
