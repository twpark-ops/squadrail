# Current RAG Architecture

Status: current implementation
Last updated: 2026-03-10

## Purpose

Squadrail's RAG layer provides task-scoped context for protocol-driven agent work. The current system is optimized for:

- workspace and repository import
- code-aware chunking
- hybrid retrieval for issue and protocol workflows
- brief generation with evidence quality metadata

It is now a graph-assisted, temporal, and role-aware retrieval runtime. The current system already includes symbol graph tables, document version snapshots, query embedding cache, and explainable role-specific personalization. It is not yet a deep call-graph or full historical code intelligence system.

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
- `code_symbols`
  - canonical symbol registry extracted during workspace import for TypeScript / JavaScript, Go, and Python
- `code_symbol_edges`
  - symbol graph edges used for 1-hop semantic expansion
- `knowledge_document_versions`
  - branch / commit / head snapshot metadata for imported document versions
- `project_knowledge_revisions`
  - per-project knowledge revision and import anchor for incremental reindex
- `retrieval_cache_entries`
  - retrieval cache storage; current runtime uses it for query embedding cache
- `retrieval_feedback_events`
  - protocol outcome feedback linked back to retrieval runs
- `retrieval_role_profiles`
  - explainable role/project/event personalization profiles derived from feedback
- `retrieval_policies`
  - per company / role / event / workflow policy for `topKDense`, `topKSparse`, `rerankK`, `finalK`, and source filters
- `retrieval_runs`
  - audit record for each brief or retrieval execution
- `retrieval_run_hits`
  - per-hit evidence trail with dense, sparse, rerank, and final rank values

### What does not exist yet

The current implementation does not have dedicated tables for:

- deep multi-hop relationship graph (`code_relationships`)
- full repository history index over arbitrary commit ranges (`code_versions`)
- per-agent black-box memory tables
- candidate / final-hit retrieval stage cache layers

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
- symbol graph traversal boosts through `code_symbol_edges`
- temporal branch / commit alignment scoring through `knowledge_document_versions`
- role-specific additive personalization boosts through `retrieval_role_profiles`
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
- `graphSeedCount`
- `graphHitCount`
- `graphEntityTypes`
- `temporalContextAvailable`
- `temporalHitCount`
- `branchAlignedTopHitCount`
- `exactCommitMatchCount`
- `personalizationApplied`
- `personalizedHitCount`
- `averagePersonalizationBoost`

This metadata is important because the system allows degraded retrieval to continue instead of hard-failing the workflow.

## Runtime Characteristics

### Current strengths

- retrieval is already code-aware, not plain document RAG
- retrieval can expand through `knowledge_chunk_links` and 1-hop symbol graph edges
- retrieval can prefer branch / commit aligned evidence when temporal context exists
- retrieval can reuse query embeddings and skip unchanged workspace imports
- retrieval can apply explainable role/project/event personalization boosts
- embeddings are optional at runtime because sparse/path/symbol retrieval still works
- repository import is scoped and noise-filtered
- retrieval results are traceable through `retrieval_runs` and `retrieval_run_hits`
- briefs expose evidence quality instead of hiding degraded retrieval

### Current limits

- symbol graph traversal is intentionally shallow and centered on 1-hop expansion
- temporal retrieval is anchored to imported branch/head snapshots, not full historical replay
- personalization is role/project/event scoped and explainable, not per-agent adaptive memory
- only query embedding cache is active today; candidate/final-hit cache is still future work
- rerank provider support is currently OpenAI-centric

## Design Decisions

### Why chunks still carry symbol metadata even with symbol tables

The runtime now has `code_symbols` and `code_symbol_edges`, but chunks still keep `symbolName` and parser metadata. This preserves fast symbol-targeted retrieval and keeps fallback behavior simple when graph expansion is unavailable or filtered out.

### Why degraded retrieval is allowed

The protocol pipeline prioritizes execution continuity. If embeddings are unavailable, sparse and heuristic retrieval still produce evidence and the brief explicitly reports the degradation.

### Why pgvector is optional

The runtime supports environments where pgvector is not installed. When available, it accelerates dense retrieval. When unavailable, retrieval still works with application-side similarity scoring.

### Why personalization is explainable

Role-specific personalization is derived from protocol outcomes such as `REQUEST_CHANGES`, `APPROVE_IMPLEMENTATION`, and `CLOSE_TASK`. The runtime stores boosts by source type, path, and symbol so the effect can be audited instead of hidden behind opaque agent memory.

## Recommended Next RAG Expansions

These are valid future improvements, but they are not part of the current implementation:

1. Deeper multi-hop graph traversal and richer edge extraction
2. Full historical version retrieval across broader commit windows
3. Candidate / final-hit cache layers for hot retrieval stages
4. Operator-driven manual pin/hide feedback surfaces on top of personalization
5. Multi-provider rerank support with stronger verification and cost controls

## Source of Truth

For current implementation details, use these code paths as the primary reference:

- `server/src/services/knowledge-import.ts`
- `server/src/services/knowledge-embeddings.ts`
- `server/src/services/issue-retrieval.ts`
- `server/src/services/retrieval-personalization.ts`
- `server/src/services/knowledge-reranking.ts`
- `packages/db/src/schema/knowledge_documents.ts`
- `packages/db/src/schema/knowledge_chunks.ts`
- `packages/db/src/schema/knowledge_chunk_links.ts`
- `packages/db/src/schema/code_symbols.ts`
- `packages/db/src/schema/code_symbol_edges.ts`
- `packages/db/src/schema/knowledge_document_versions.ts`
- `packages/db/src/schema/project_knowledge_revisions.ts`
- `packages/db/src/schema/retrieval_cache_entries.ts`
- `packages/db/src/schema/retrieval_feedback_events.ts`
- `packages/db/src/schema/retrieval_role_profiles.ts`
- `packages/db/src/schema/retrieval_policies.ts`
- `packages/db/src/schema/retrieval_runs.ts`
- `packages/db/src/schema/retrieval_run_hits.ts`
