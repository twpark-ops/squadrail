# Natural-Language Code Summary RAG Plan

Status: proposed productization plan  
Last updated: 2026-03-14

## Purpose

Squadrail's current RAG layer is already strong at:

- workspace and repository import
- symbol-aware chunking
- code graph extraction
- issue / protocol / role-aware retrieval

What is still missing is a first-class semantic layer that can answer questions such as:

- "What does this file do in the system?"
- "Why does this module exist?"
- "Where is the review gate enforced?"
- "Which code is responsible for retry behavior?"

This document defines the recommended way to add that missing layer without breaking Squadrail's existing retrieval kernel.

## Core Decision

Squadrail should **not** replace its current retrieval kernel with an external code search product.

Instead, Squadrail should:

1. keep the current `raw code + symbol graph + issue/history memory` retrieval runtime
2. add a **natural-language code summary layer** on top
3. score and personalize that new source through the same lane-aware and role-aware pipeline

In short:

`existing code-aware retrieval` + `natural-language semantic summaries`  
not  
`external semantic code search product as the core retrieval engine`

## Why Not Use External Products As The Core

External products such as GitHub Copilot codebase exploration, Sourcegraph Cody, GitLab semantic code search, or Greptile-like tools are useful references, but they are not the right ownership boundary for Squadrail's product kernel.

### Reason 1: Squadrail's retrieval is workflow-aware

The current runtime is not generic repository search. It is already shaped by:

- protocol message type
- workflow state
- recipient role
- issue / project / branch / review context
- operator feedback

These signals are part of Squadrail's product differentiation and already live in the retrieval runtime.

### Reason 2: role-aware personalization would be lost

Squadrail already maintains explainable role-specific retrieval behavior. For example:

- engineers should see implementation-heavy code and tests
- reviewers should see review evidence and risky change surfaces
- human board should see high-level product, ADR, review, and protocol context

This is part of the current service layer:

- [retrieval-personalization.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval-personalization.ts)
- [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)

If the core search step is delegated to an opaque external product, Squadrail loses direct control over those scoring decisions.

### Reason 3: protocol context is first-class in Squadrail

Current retrieval query construction is already driven by issue and protocol context:

- [query.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/query.ts#L267)

The system is not just asking "find related code." It is asking:

- who is receiving this brief
- what workflow state they are in
- what the current protocol handoff requires

That should stay inside the product.

## What Already Exists

Squadrail is not starting from zero.

### Code-aware chunking already exists

- TypeScript / JavaScript top-level AST extraction:
  - [knowledge-import.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-import.ts#L567)
- semantic top-level symbol chunking for multiple languages:
  - [knowledge-import.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-import.ts#L1629)

### Code graph extraction already exists

- symbol and edge construction for imported code:
  - [knowledge-import.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-import.ts#L1215)

### Retrieval runtime already exists

- retrieval query construction:
  - [query.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/query.ts#L267)
- knowledge graph read API:
  - [knowledge.ts](/home/taewoong/company-project/squadall/server/src/routes/knowledge.ts#L171)
- chunk embedding vector synchronization:
  - [knowledge.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge.ts#L642)

### Current data model already supports extension

- chunk storage:
  - [knowledge_chunks.ts](/home/taewoong/company-project/squadall/packages/db/src/schema/knowledge_chunks.ts)
- symbol graph:
  - [code_symbols.ts](/home/taewoong/company-project/squadall/packages/db/src/schema/code_symbols.ts)
  - [code_symbol_edges.ts](/home/taewoong/company-project/squadall/packages/db/src/schema/code_symbol_edges.ts)

## What Is Missing

The missing layer is **natural-language semantic meaning** for code artifacts.

Current Squadrail retrieval can already find:

- the function
- the file
- the path
- the symbol
- the issue history

But it cannot yet persist and retrieve statements like:

- "This module coordinates retry dispatch and wake-up routing."
- "This file is the main policy gate for review-state transitions."
- "This symbol is used as the entry point for knowledge sync orchestration."

That semantic layer is what should be added next.

## Recommended Architecture

### Principle

Do **not** attach a single `symbol_description` field to raw code chunks as the first design.

Instead, create a separate summary source that can be indexed, linked, versioned, and weighted independently.

### Recommended source types

Add one or both of these as new knowledge sources:

- `code_summary`
- `symbol_summary`

### Why separate source types are better

Separate summary documents/chunks are better than storing summary text directly on raw code rows because they:

- keep raw code and derived meaning separate
- allow independent embedding generation
- allow separate source-type weighting in retrieval
- allow different summary variants later
  - engineer-oriented summary
  - reviewer-oriented summary
  - PM-oriented summary
- make versioning and invalidation cleaner

## Recommended Data Model

### Keep existing raw code chunks unchanged

Current `knowledge_chunks` rows should continue to represent:

- raw code chunks
- markdown chunks
- test chunks
- existing imported artifact chunks

### Add summary documents/chunks as derived artifacts

Recommended structure:

1. import workspace file
2. extract code chunks and symbols
3. generate one or more natural-language summaries
4. store them as separate `knowledge_documents` / `knowledge_chunks`
5. connect them back to raw code and symbol graph through `knowledge_chunk_links`

### Suggested summary metadata

Each summary chunk should capture fields such as:

- `summaryKind`
  - `file`
  - `module`
  - `symbol`
- `sourceDocumentId`
- `sourceChunkId`
- `sourceSymbolKey`
- `language`
- `path`
- `projectId`
- `repoRef`
- `generationModel`
- `summaryVersion`

### Suggested summary content contract

Keep the summary format structured and short. A good v1 shape is:

- `what_it_does`
- `why_it_exists`
- `entrypoints`
- `depends_on`
- `used_by`
- `side_effects`
- `test_surface`

These can be rendered as markdown or stored in structured JSON and flattened into retrieval text.

## Retrieval Integration

The new summary source should be added as another retrieval source, not as a replacement.

### Retrieval should remain hybrid

Final retrieval should combine:

- raw code
- symbol graph
- path and file matches
- issue and protocol history
- natural-language code summaries

### Personalization should remain intact

The existing role-aware pipeline should continue to decide how much the new source matters.

Examples:

- engineer:
  - raw code and tests remain dominant
  - summary helps fast orientation
- reviewer:
  - summary can be weighted higher when understanding purpose and risk
- human board:
  - summary can be weighted much higher than raw code

This preserves Squadrail's product logic instead of replacing it.

## What To Reuse

Squadrail should reuse **components**, not whole products.

### Reuse directly

- parser / syntax infrastructure such as `tree-sitter`
- hierarchical chunking ideas
- embedding + vector indexing patterns
- code summarization prompt patterns

### Do not use as the core retrieval kernel

- GitHub Copilot as the primary codebase engine
- Sourcegraph Cody as the primary knowledge engine
- GitLab semantic code search as the primary company knowledge engine
- Greptile-like hosted semantic code search as the authoritative retrieval layer

These tools are good references and internal developer aids, but not the ownership boundary for Squadrail's product kernel.

## Phased Implementation Plan

### Phase 1: summary source contract

Goal:

- define `code_summary` / `symbol_summary` source types
- define metadata contract
- define summary generation trigger points

Deliverables:

- shared source type additions
- schema update for derived summary metadata
- retrieval policy awareness for summary sources

### Phase 2: import-time summary generation

Goal:

- generate short natural-language summaries during workspace import or backfill

Deliverables:

- file or symbol summary generator
- summary persistence as derived knowledge artifacts
- summary embedding generation

### Phase 3: retrieval integration

Goal:

- add summary source into current scoring and policy flow

Deliverables:

- source-type weighting for summaries
- role-aware summary weighting
- summary hit trace in retrieval runs

### Phase 4: operator surfaces

Goal:

- expose the meaning layer in UI

Deliverables:

- Knowledge detail showing code summary alongside raw code links
- change/review surfaces showing "what this code does" context
- issue detail / clarification surfaces that can cite summary evidence

## Recommended v1 Scope

The correct first implementation is narrow:

- summarize top-level file/module purpose
- summarize extracted top-level symbols
- index those summaries separately
- wire them into retrieval scoring

Do not start with:

- full repository-wide natural language chat
- arbitrary codebase Q&A UI
- multi-agent conversational reasoning over the repository
- replacing the current retrieval core

## Non-Goals

This plan does not aim to:

- build a new semantic search engine from scratch
- replace existing code graph retrieval
- replace existing issue/protocol memory retrieval
- make raw code optional
- turn Squadrail into a generic code chat product

## Final Recommendation

The right move for Squadrail is:

1. keep the existing code-aware retrieval kernel
2. add a derived natural-language summary layer for files/modules/symbols
3. index that summary layer separately
4. retrieve it through the same role-aware, lane-aware, protocol-aware scoring pipeline

This keeps ownership of product logic inside Squadrail while reusing parser and embedding building blocks from the broader ecosystem.

## External References

- GitHub Copilot codebase exploration:
  - [docs.github.com/en/copilot/tutorials/explore-a-codebase](https://docs.github.com/en/copilot/tutorials/explore-a-codebase)
- Sourcegraph Cody context:
  - [sourcegraph.com/docs/cody/core-concepts/context](https://sourcegraph.com/docs/cody/core-concepts/context)
- GitLab semantic code search:
  - [docs.gitlab.com/user/gitlab_duo/semantic_code_search/](https://docs.gitlab.com/user/gitlab_duo/semantic_code_search/)
- Continue embeddings:
  - [docs.continue.dev/advanced/model-roles/embeddings](https://docs.continue.dev/advanced/model-roles/embeddings)
- Continue custom code RAG:
  - [docs.continue.dev/guides/custom-code-rag](https://www.docs.continue.dev/guides/custom-code-rag)
- RepoCoder paper:
  - [aclanthology.org/2023.emnlp-main.151.pdf](https://aclanthology.org/2023.emnlp-main.151.pdf)
