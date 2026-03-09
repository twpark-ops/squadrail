# Current RAG Architecture

Status: current implementation
Last updated: 2026-03-10

## Purpose

Squadrail's RAG layer provides task-scoped context for protocol-driven agent work. The current system is optimized for:

- workspace and repository import
- code-aware chunking
- hybrid retrieval for issue and protocol workflows
- brief generation with evidence quality metadata

It is not yet a graph-backed code intelligence system. Symbol graphs, agent personalization tables, and retrieval caches are future expansion areas, not part of the current runtime.

## Current Data Model

### Core tables

- `knowledge_documents`
  - document-level metadata for imported repository files, issue artifacts, and protocol-linked knowledge
  - includes scope fields such as `projectId`, `issueId`, `messageId`, `repoUrl`, `repoRef`, `path`
- `knowledge_chunks`
  - chunked retrieval units with `headingPath`, `symbolName`, `searchTsv`, `embedding`, and freeform `metadata`
  - embeddings are stored as JSON arrays today
- `knowledge_chunk_links`
  - lightweight link table used for rerank boosts
  - current entity types are primarily `project`, `workspace`, `path`, and `symbol`
- `retrieval_policies`
  - per company / role / event / workflow policy for `topKDense`, `topKSparse`, `rerankK`, `finalK`, and source filters
- `retrieval_runs`
  - audit record for each brief or retrieval execution
- `retrieval_run_hits`
  - per-hit evidence trail with dense, sparse, rerank, and final rank values

### What does not exist yet

The current implementation does not have dedicated tables for:

- symbol registry (`code_symbols`)
- relationship graph (`code_relationships`)
- temporal code versions (`code_versions`)
- agent learning feedback (`agent_knowledge_feedback`, `agent_chunk_rankings`)
- retrieval cache layers (`retrieval_cache`, `retrieval_stage_cache`)

## Ingestion Pipeline

### Entry points

The active ingestion path is workspace import. The system scans the configured project workspace and imports selected files into `knowledge_documents` and `knowledge_chunks`.

### File selection and prioritization

The importer currently:

- ignores `.git`, `node_modules`, build outputs, hidden tooling directories, and common cache folders
- excludes generated files such as protobuf outputs and other codegen artifacts
- deprioritizes docs and deployment folders
- prioritizes source-heavy directories such as `src`, `server`, `service`, `internal`, `pkg`, `worker`
- marks test-like files and tags them separately

### Chunking strategy

The current chunker is already code-aware:

- TypeScript / JavaScript:
  - top-level AST extraction using the TypeScript compiler
  - symbol chunks for functions, classes, interfaces, types, enums, and variables
- Python, Go, Rust, Java, Kotlin, Swift, Ruby, PHP, Shell, SQL:
  - semantic or heuristic top-level symbol chunking
- Markdown:
  - section-based chunking with heading path preservation
- Fallback:
  - line-window chunking when no symbol structure is found

Oversized chunks are split again before embedding so they stay within embedding input limits.

### Embeddings

- provider: OpenAI
- default model: `text-embedding-3-small`
- storage: JSON embedding arrays in `knowledge_chunks.embedding`
- batching, truncation, and retry-on-context-limit are already implemented

## Retrieval Pipeline

### Stage 1: candidate generation

The current retrieval path combines multiple candidate sets:

- dense retrieval
  - uses `embedding_vector` with pgvector when available
  - falls back to application-side cosine similarity when pgvector is unavailable
- sparse retrieval
  - PostgreSQL full-text search over `knowledge_chunks.searchTsv`
- exact path retrieval
- symbol hint retrieval

### Stage 2: merge and score

Candidate sets are merged and fused. Current scoring includes:

- dense score
- sparse score
- scope rank for issue / project locality
- source type boost
- authority boost
- path match boost
- symbol exact / partial boost
- tag match boost
- latest and freshness boosts
- issue / project / path link boosts through `knowledge_chunk_links`
- penalties for expired, superseded, or future-invalid documents

### Stage 3: optional model rerank

The current model rerank path is optional and uses the OpenAI Responses API. It is not tied to a Claude-specific reranker.

### Stage 4: brief generation

Selected evidence is written into retrieval runs and used to generate task briefs for protocol recipients.

Brief output includes quality metadata:

- `confidenceLevel`
- `evidenceCount`
- `denseEnabled`
- `denseHitCount`
- `sparseHitCount`
- `pathHitCount`
- `symbolHitCount`
- `sourceDiversity`
- `degradedReasons`

This metadata is important because the system allows degraded retrieval to continue instead of hard-failing the workflow.

## Runtime Characteristics

### Current strengths

- retrieval is already code-aware, not plain document RAG
- embeddings are optional at runtime because sparse/path/symbol retrieval still works
- repository import is scoped and noise-filtered
- retrieval results are traceable through `retrieval_runs` and `retrieval_run_hits`
- briefs expose evidence quality instead of hiding degraded retrieval

### Current limits

- no persistent code graph traversal
- no dedicated symbol registry outside chunk metadata
- no temporal version retrieval over code history
- no agent-personalized ranking memory
- no explicit retrieval cache layers
- rerank provider support is currently OpenAI-centric

## Design Decisions

### Why chunks still carry symbol metadata

Instead of maintaining separate symbol tables today, the system keeps symbol-aware retrieval lightweight by storing `symbolName` and parser metadata directly on chunks. This reduces migration cost and keeps import throughput simple while still enabling symbol-targeted retrieval.

### Why degraded retrieval is allowed

The protocol pipeline prioritizes execution continuity. If embeddings are unavailable, sparse and heuristic retrieval still produce evidence and the brief explicitly reports the degradation.

### Why pgvector is optional

The runtime supports environments where pgvector is not installed. When available, it accelerates dense retrieval. When unavailable, retrieval still works with application-side similarity scoring.

## Recommended Next RAG Expansions

These are valid future improvements, but they are not part of the current implementation:

1. Dedicated symbol registry and relationship graph
2. Temporal code version indexing with commit-aware retrieval
3. Agent feedback accumulation and personalization boosts
4. Retrieval cache layers for hot queries and intermediate stages
5. Multi-provider rerank support with stronger verification and cost controls

## Source of Truth

For current implementation details, use these code paths as the primary reference:

- `server/src/services/knowledge-import.ts`
- `server/src/services/knowledge-embeddings.ts`
- `server/src/services/issue-retrieval.ts`
- `server/src/services/knowledge-reranking.ts`
- `packages/db/src/schema/knowledge_documents.ts`
- `packages/db/src/schema/knowledge_chunks.ts`
- `packages/db/src/schema/knowledge_chunk_links.ts`
- `packages/db/src/schema/retrieval_policies.ts`
- `packages/db/src/schema/retrieval_runs.ts`
- `packages/db/src/schema/retrieval_run_hits.ts`
