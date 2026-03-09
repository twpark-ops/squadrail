#!/usr/bin/env tsx
/**
 * Verify retrieval configuration
 *
 * This script checks if the knowledge retrieval system is properly configured:
 * - OpenAI API key
 * - Embedding provider
 * - Database connectivity
 * - Retrieval policies
 */

import { knowledgeEmbeddingService } from "../src/services/knowledge-embeddings.js";
import { db } from "@squadrail/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=".repeat(60));
  console.log("RETRIEVAL CONFIGURATION VERIFICATION");
  console.log("=".repeat(60));
  console.log();

  // 1. Check embedding provider
  console.log("1. Checking embedding provider...");
  const embeddings = knowledgeEmbeddingService();
  const providerInfo = embeddings.getProviderInfo();

  if (providerInfo.available) {
    console.log("   ✅ Embedding provider configured");
    console.log(`   - Provider: ${providerInfo.provider}`);
    console.log(`   - Model: ${providerInfo.model}`);
    console.log(`   - Dimensions: ${providerInfo.dimensions}`);
    console.log(`   - Endpoint: ${providerInfo.endpoint}`);
  } else {
    console.log("   ❌ Embedding provider NOT configured");
    console.log("   - Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY");
    console.log("   - Dense vector search will be disabled");
  }
  console.log();

  // 2. Test embedding generation
  if (providerInfo.available) {
    console.log("2. Testing embedding generation...");
    try {
      const testResult = await embeddings.generateEmbeddings(["test query"]);
      console.log("   ✅ Embedding generation successful");
      console.log(`   - Generated ${testResult.embeddings.length} embedding(s)`);
      console.log(`   - Token usage: ${testResult.usage.totalTokens} tokens`);
    } catch (err) {
      console.log("   ❌ Embedding generation failed");
      console.log(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  // 3. Check database connectivity
  console.log("3. Checking database connectivity...");
  try {
    await db.execute(sql`SELECT 1`);
    console.log("   ✅ Database connection successful");
  } catch (err) {
    console.log("   ❌ Database connection failed");
    console.log(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log();

  // 4. Check knowledge base statistics
  console.log("4. Checking knowledge base statistics...");
  try {
    const [docCount] = await db.execute(
      sql`SELECT COUNT(*) as count FROM knowledge_documents`
    );
    const [chunkCount] = await db.execute(
      sql`SELECT COUNT(*) as count FROM knowledge_chunks`
    );
    const [embeddedCount] = await db.execute(
      sql`SELECT COUNT(*) as count FROM knowledge_chunks WHERE embedding IS NOT NULL`
    );

    const docs = Number((docCount as any)?.count ?? 0);
    const chunks = Number((chunkCount as any)?.count ?? 0);
    const embedded = Number((embeddedCount as any)?.count ?? 0);

    console.log(`   - Documents: ${docs}`);
    console.log(`   - Chunks: ${chunks}`);
    console.log(`   - Embedded chunks: ${embedded} (${chunks > 0 ? Math.round((embedded / chunks) * 100) : 0}%)`);

    if (docs === 0) {
      console.log("   ⚠️  No documents in knowledge base");
    } else if (embedded < chunks * 0.5 && providerInfo.available) {
      console.log("   ⚠️  Less than 50% of chunks have embeddings");
      console.log("   - Run embedding generation to improve retrieval quality");
    } else {
      console.log("   ✅ Knowledge base ready");
    }
  } catch (err) {
    console.log("   ❌ Failed to check knowledge base");
    console.log(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // 5. Check retrieval policies
  console.log("5. Checking retrieval policies...");
  try {
    const [policyCount] = await db.execute(
      sql`SELECT COUNT(*) as count FROM retrieval_policies`
    );
    const count = Number((policyCount as any)?.count ?? 0);

    if (count === 0) {
      console.log("   ⚠️  No retrieval policies configured");
      console.log("   - Policies will be auto-created on first retrieval");
    } else {
      console.log(`   ✅ ${count} retrieval policies configured`);

      // Show engineer policies
      const engineerPolicies = await db.execute(
        sql`SELECT event_type, top_k_sparse, top_k_dense, final_k
            FROM retrieval_policies
            WHERE role = 'engineer'
            LIMIT 5`
      );

      if (Array.isArray(engineerPolicies) && engineerPolicies.length > 0) {
        console.log("   - Engineer policies:");
        for (const policy of engineerPolicies) {
          console.log(`     - ${(policy as any).event_type}: sparse=${(policy as any).top_k_sparse}, dense=${(policy as any).top_k_dense}, final=${(policy as any).final_k}`);
        }
      }
    }
  } catch (err) {
    console.log("   ❌ Failed to check retrieval policies");
    console.log(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // 6. Check retrieval runs
  console.log("6. Checking retrieval history...");
  try {
    const [runCount] = await db.execute(
      sql`SELECT COUNT(*) as count FROM retrieval_runs`
    );
    const [briefCount] = await db.execute(
      sql`SELECT COUNT(*) as count FROM task_briefs`
    );

    const runs = Number((runCount as any)?.count ?? 0);
    const briefs = Number((briefCount as any)?.count ?? 0);

    console.log(`   - Retrieval runs: ${runs}`);
    console.log(`   - Task briefs: ${briefs}`);

    if (runs === 0 && briefs === 0) {
      console.log("   ℹ️  No retrieval history yet");
      console.log("   - Create an issue and assign it to an agent to trigger retrieval");
    } else {
      console.log("   ✅ Retrieval system has been used");
    }
  } catch (err) {
    console.log("   ❌ Failed to check retrieval history");
    console.log(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();

  // Summary
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  if (!providerInfo.available) {
    console.log("⚠️  CONFIGURATION INCOMPLETE");
    console.log();
    console.log("Required actions:");
    console.log("1. Set OPENAI_API_KEY in .env file");
    console.log("2. Restart the server");
    console.log("3. Run this script again to verify");
    console.log();
    console.log("Example:");
    console.log('  echo "OPENAI_API_KEY=sk-..." >> .env');
    process.exit(1);
  } else {
    console.log("✅ CONFIGURATION COMPLETE");
    console.log();
    console.log("The retrieval system is ready to use.");
    console.log("Create an issue and assign it to trigger brief generation.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
