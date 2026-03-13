#!/usr/bin/env tsx
import { db } from "@squadrail/db";
import { sql } from "drizzle-orm";
import { knowledgeEmbeddingService } from "../src/services/knowledge-embeddings.js";
import { runRetrievalConfigVerification } from "../src/scripts/verify-retrieval-config-lib.js";

runRetrievalConfigVerification({
  embeddings: knowledgeEmbeddingService(),
  db,
  sql,
})
  .then((result) => {
    if (!result.ok) {
      process.exit(result.exitCode);
    }
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
