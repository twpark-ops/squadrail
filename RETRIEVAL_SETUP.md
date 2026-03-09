# Knowledge Retrieval Setup Guide

## Overview

The knowledge retrieval system automatically generates context briefs for agents when tasks are assigned or updated. This guide covers configuration and troubleshooting.

## Prerequisites

1. **OpenAI API Key** (Required)
   - Get your key from: https://platform.openai.com/api-keys
   - Used for generating embeddings for dense vector search

2. **Knowledge Base** (Required)
   - Documents must be ingested into `knowledge_documents` table
   - Chunks must be generated in `knowledge_chunks` table
   - Embeddings should be generated for optimal performance

## Configuration

### 1. Set OpenAI API Key

Add to `.env` file:

```bash
OPENAI_API_KEY=sk-your-api-key-here
```

Or use environment-specific variable:

```bash
SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY=sk-your-api-key-here
```

### 2. Optional Configuration

Override embedding model:

```bash
SQUADRAIL_KNOWLEDGE_EMBEDDING_MODEL=text-embedding-3-small
SQUADRAIL_KNOWLEDGE_EMBEDDING_ENDPOINT=https://api.openai.com/v1/embeddings
```

### 3. Verify Configuration

Run the verification script:

```bash
cd server
npm run tsx scripts/verify-retrieval-config.ts
```

Expected output:

```
✅ Embedding provider configured
✅ Database connection successful
✅ Knowledge base ready
✅ CONFIGURATION COMPLETE
```

## How It Works

### Trigger Events

Briefs are automatically generated when:

- Task is assigned (`ASSIGN_TASK`, `REASSIGN_TASK`)
- Agent accepts assignment (`ACK_ASSIGNMENT`)
- Agent reports progress (`REPORT_PROGRESS`)
- Plan is requested (`PROPOSE_PLAN`)
- Blocker is escalated (`ESCALATE_BLOCKER`)
- Review events occur (`START_REVIEW`, `REQUEST_CHANGES`, `APPROVE_IMPLEMENTATION`)

### Retrieval Process

1. **Event Detection**: Protocol message triggers retrieval
2. **Policy Resolution**: Get or create retrieval policy for recipient role
3. **Query Generation**: Build query from issue title, description, and message
4. **Hybrid Search**:
   - **Sparse**: Full-text search (BM25-like)
   - **Dense**: Vector similarity search (requires embeddings)
   - **Path**: Exact file path matches
   - **Symbol**: Code symbol matches
5. **Reranking**: Combine and rerank results
6. **Brief Generation**: Create markdown brief with top results
7. **Notification**: Send brief to recipient via protocol message

### Search Quality

| Configuration | Search Quality | Latency |
|--------------|----------------|---------|
| No embeddings | 60% | Fast |
| With embeddings | 95% | Moderate |
| + Model rerank | 98% | Slower |

**Recommendation**: Always configure embeddings for production use.

## Troubleshooting

### Brief Not Generated

**Symptom**: No brief in retrieval_runs table after task assignment

**Diagnosis**:

```bash
# Check server logs
tail -f logs/server.log | grep RETRIEVAL

# Check embedding provider
npm run tsx scripts/verify-retrieval-config.ts
```

**Common causes**:

1. **OPENAI_API_KEY not set**
   - Solution: Add to `.env` file
   - Brief will still be generated but with sparse search only

2. **No knowledge documents**
   ```sql
   SELECT COUNT(*) FROM knowledge_documents;
   -- Expected: > 0
   ```
   - Solution: Ingest documents first

3. **Recipients not eligible**
   - Only `engineer`, `reviewer`, `tech_lead`, `human_board` roles trigger retrieval
   - Solution: Check message recipients

4. **Event type not mapped**
   - Check `RETRIEVAL_EVENT_BY_MESSAGE_TYPE` in `issue-retrieval.ts`
   - Solution: Message type might not trigger retrieval

### Low Quality Results

**Symptom**: Brief contains irrelevant or missing information

**Diagnosis**:

```sql
SELECT
  r.id,
  r.actor_role,
  r.event_type,
  (r.query_debug->>'denseEnabled')::boolean as dense_enabled,
  json_array_length((SELECT json_agg(h) FROM retrieval_hits h WHERE h.retrieval_run_id = r.id)) as hit_count
FROM retrieval_runs r
ORDER BY r.created_at DESC
LIMIT 5;
```

**Solutions**:

1. **Embeddings not generated**
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE embedding IS NOT NULL) as embedded,
     COUNT(*) as total,
     ROUND(COUNT(*) FILTER (WHERE embedding IS NOT NULL)::numeric / COUNT(*) * 100, 1) as percentage
   FROM knowledge_chunks;
   ```
   - If < 90%: Generate embeddings for all chunks

2. **Poor document quality**
   - Review document ingestion
   - Check chunk size and overlap
   - Verify metadata (paths, symbols)

3. **Retrieval policy tuning**
   ```sql
   SELECT * FROM retrieval_policies
   WHERE role = 'engineer' AND event_type = 'on_assignment';
   ```
   - Adjust `top_k_sparse`, `top_k_dense`, `final_k`
   - Modify `allowed_source_types`

### Embedding Generation Fails

**Symptom**: Logs show "Embedding generation failed"

**Common causes**:

1. **Invalid API key**
   - Error: `401 Unauthorized`
   - Solution: Check API key validity

2. **Rate limit exceeded**
   - Error: `429 Too Many Requests`
   - Solution: Implement backoff or upgrade plan

3. **Network issues**
   - Error: `Connection timeout`
   - Solution: Check firewall/proxy settings

4. **Input too long**
   - Error: `Token limit exceeded`
   - Solution: Chunks are auto-truncated to 4000 words

## Performance Tuning

### Retrieval Policy Parameters

```typescript
{
  topKSparse: 20,      // Sparse search results (higher = more recall)
  topKDense: 15,       // Dense search results (higher = more recall)
  rerankK: 30,         // Candidates for reranking (higher = better quality)
  finalK: 10,          // Final results in brief (higher = more context)
}
```

**Trade-offs**:
- Higher K values = Better recall, slower retrieval
- Lower K values = Faster retrieval, may miss relevant docs

**Recommendations**:
- `engineer` role: finalK = 10-15
- `reviewer` role: finalK = 8-12
- `tech_lead` role: finalK = 6-10

### Caching Strategy

Not implemented yet. Future optimization:
- Cache embeddings for common queries
- Cache retrieval results for similar issues
- Invalidate on knowledge base updates

## Monitoring

### Key Metrics

```sql
-- Retrieval success rate (last 24h)
SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE (query_debug->>'denseEnabled')::boolean) as with_embeddings,
  AVG(created_at - (SELECT created_at FROM protocol_messages WHERE id = r.triggering_message_id)) as avg_latency
FROM retrieval_runs r
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Brief generation stats
SELECT
  brief_scope,
  COUNT(*) as total,
  AVG(brief_version) as avg_version
FROM task_briefs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY brief_scope;

-- Hit distribution
SELECT
  source_type,
  COUNT(*) as hit_count,
  AVG(fused_score) as avg_score
FROM retrieval_hits
GROUP BY source_type
ORDER BY hit_count DESC;
```

### Health Check

Add to monitoring:

```bash
curl http://localhost:3100/api/health/retrieval
```

Expected response:

```json
{
  "embedding_provider": "openai",
  "embedding_model": "text-embedding-3-small",
  "knowledge_documents": 491,
  "knowledge_chunks": 7939,
  "embedded_percentage": 100,
  "last_retrieval_run": "2026-03-09T10:15:00Z"
}
```

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Protocol Message                         │
│                  (ASSIGN_TASK, etc.)                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              issueRetrieval.handleProtocolMessage           │
├─────────────────────────────────────────────────────────────┤
│ 1. Derive event type                                        │
│ 2. Get/create retrieval policy                              │
│ 3. Build query text                                         │
│ 4. Generate embedding (OpenAI)                              │
│ 5. Execute hybrid search                                    │
│    ├─ Sparse (full-text)                                    │
│    ├─ Dense (vector similarity)                             │
│    ├─ Path (exact matches)                                  │
│    └─ Symbol (code entities)                                │
│ 6. Rerank results                                           │
│ 7. Generate brief                                           │
│ 8. Log activity                                             │
│ 9. Publish live event                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      Task Brief                             │
│         (Stored in task_briefs table)                       │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema

```sql
-- Retrieval configuration
retrieval_policies (
  id, role, event_type, workflow_state,
  top_k_sparse, top_k_dense, rerank_k, final_k,
  allowed_source_types, allowed_authority_levels
)

-- Retrieval execution
retrieval_runs (
  id, company_id, issue_id, triggering_message_id,
  actor_role, event_type, query_text, query_debug
)

-- Retrieval results
retrieval_hits (
  id, retrieval_run_id, chunk_id,
  dense_score, sparse_score, rerank_score, fused_score,
  final_rank
)

-- Generated briefs
task_briefs (
  id, issue_id, brief_scope, brief_version,
  content_markdown, content_json, retrieval_run_id
)
```

## Development

### Adding New Event Types

1. Add to `RETRIEVAL_EVENT_BY_MESSAGE_TYPE`:

```typescript
const RETRIEVAL_EVENT_BY_MESSAGE_TYPE = {
  NEW_MESSAGE_TYPE: "on_new_event",
  // ...
};
```

2. Add default policy template in `defaultPolicyTemplate()`:

```typescript
if (eventType === "on_new_event") {
  return {
    topKSparse: 20,
    topKDense: 15,
    rerankK: 30,
    finalK: 10,
    // ...
  };
}
```

3. Test with new message type

### Debugging

Enable debug logging:

```typescript
// server/src/services/issue-retrieval.ts
console.log("[RETRIEVAL] Debug info:", { ... });
```

Check output:

```bash
npm run dev | grep RETRIEVAL
```

## References

- Embedding Model: [text-embedding-3-small](https://platform.openai.com/docs/guides/embeddings)
- Database Schema: `packages/db/src/schema`
- Implementation: `server/src/services/issue-retrieval.ts`
- API Routes: `server/src/routes/issues.ts`
