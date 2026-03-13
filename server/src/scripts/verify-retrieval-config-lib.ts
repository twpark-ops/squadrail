import type { SQLWrapper } from "drizzle-orm";

export interface RetrievalConfigVerifier {
  getProviderInfo(): {
    available: boolean;
    provider: string | null;
    model: string | null;
    dimensions: number | null;
    endpoint: string | null;
  };
  generateEmbeddings(input: string[]): Promise<{
    embeddings: number[][];
    usage: {
      totalTokens: number;
    };
  }>;
}

export interface RetrievalConfigDb {
  execute<T = unknown>(query: SQLWrapper | unknown): Promise<T[]>;
}

export interface RetrievalConfigVerificationResult {
  ok: boolean;
  exitCode: 0 | 1;
}

export async function runRetrievalConfigVerification(input: {
  embeddings: RetrievalConfigVerifier;
  db: RetrievalConfigDb;
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
  print?: (line?: string) => void;
}): Promise<RetrievalConfigVerificationResult> {
  const print = input.print ?? ((line = "") => console.log(line));
  const { db, embeddings, sql } = input;

  print("=".repeat(60));
  print("RETRIEVAL CONFIGURATION VERIFICATION");
  print("=".repeat(60));
  print();

  print("1. Checking embedding provider...");
  const providerInfo = embeddings.getProviderInfo();
  if (providerInfo.available) {
    print("   ✅ Embedding provider configured");
    print(`   - Provider: ${providerInfo.provider}`);
    print(`   - Model: ${providerInfo.model}`);
    print(`   - Dimensions: ${providerInfo.dimensions}`);
    print(`   - Endpoint: ${providerInfo.endpoint}`);
  } else {
    print("   ❌ Embedding provider NOT configured");
    print("   - Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY");
    print("   - Dense vector search will be disabled");
  }
  print();

  if (providerInfo.available) {
    print("2. Testing embedding generation...");
    try {
      const testResult = await embeddings.generateEmbeddings(["test query"]);
      print("   ✅ Embedding generation successful");
      print(`   - Generated ${testResult.embeddings.length} embedding(s)`);
      print(`   - Token usage: ${testResult.usage.totalTokens} tokens`);
    } catch (err) {
      print("   ❌ Embedding generation failed");
      print(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    print();
  }

  print("3. Checking database connectivity...");
  try {
    await db.execute(sql`SELECT 1`);
    print("   ✅ Database connection successful");
  } catch (err) {
    print("   ❌ Database connection failed");
    print(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, exitCode: 1 };
  }
  print();

  print("4. Checking knowledge base statistics...");
  try {
    const [docCount] = await db.execute<{ count?: number | string }>(
      sql`SELECT COUNT(*) as count FROM knowledge_documents`,
    );
    const [chunkCount] = await db.execute<{ count?: number | string }>(
      sql`SELECT COUNT(*) as count FROM knowledge_chunks`,
    );
    const [embeddedCount] = await db.execute<{ count?: number | string }>(
      sql`SELECT COUNT(*) as count FROM knowledge_chunks WHERE embedding IS NOT NULL`,
    );

    const docs = Number(docCount?.count ?? 0);
    const chunks = Number(chunkCount?.count ?? 0);
    const embedded = Number(embeddedCount?.count ?? 0);

    print(`   - Documents: ${docs}`);
    print(`   - Chunks: ${chunks}`);
    print(`   - Embedded chunks: ${embedded} (${chunks > 0 ? Math.round((embedded / chunks) * 100) : 0}%)`);

    if (docs === 0) {
      print("   ⚠️  No documents in knowledge base");
    } else if (embedded < chunks * 0.5 && providerInfo.available) {
      print("   ⚠️  Less than 50% of chunks have embeddings");
      print("   - Run embedding generation to improve retrieval quality");
    } else {
      print("   ✅ Knowledge base ready");
    }
  } catch (err) {
    print("   ❌ Failed to check knowledge base");
    print(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  print();

  print("5. Checking retrieval policies...");
  try {
    const [policyCount] = await db.execute<{ count?: number | string }>(
      sql`SELECT COUNT(*) as count FROM retrieval_policies`,
    );
    const count = Number(policyCount?.count ?? 0);

    if (count === 0) {
      print("   ⚠️  No retrieval policies configured");
      print("   - Policies will be auto-created on first retrieval");
    } else {
      print(`   ✅ ${count} retrieval policies configured`);
      const engineerPolicies = await db.execute<{
        event_type?: string;
        top_k_sparse?: number | string;
        top_k_dense?: number | string;
        final_k?: number | string;
      }>(
        sql`SELECT event_type, top_k_sparse, top_k_dense, final_k
            FROM retrieval_policies
            WHERE role = 'engineer'
            LIMIT 5`,
      );

      if (Array.isArray(engineerPolicies) && engineerPolicies.length > 0) {
        print("   - Engineer policies:");
        for (const policy of engineerPolicies) {
          print(
            `     - ${String(policy.event_type ?? "unknown")}: sparse=${Number(policy.top_k_sparse ?? 0)}, dense=${Number(policy.top_k_dense ?? 0)}, final=${Number(policy.final_k ?? 0)}`,
          );
        }
      }
    }
  } catch (err) {
    print("   ❌ Failed to check retrieval policies");
    print(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  print();

  print("6. Checking retrieval history...");
  try {
    const [runCount] = await db.execute<{ count?: number | string }>(
      sql`SELECT COUNT(*) as count FROM retrieval_runs`,
    );
    const [briefCount] = await db.execute<{ count?: number | string }>(
      sql`SELECT COUNT(*) as count FROM task_briefs`,
    );

    const runs = Number(runCount?.count ?? 0);
    const briefs = Number(briefCount?.count ?? 0);

    print(`   - Retrieval runs: ${runs}`);
    print(`   - Task briefs: ${briefs}`);

    if (runs === 0 && briefs === 0) {
      print("   ℹ️  No retrieval history yet");
      print("   - Create an issue and assign it to an agent to trigger retrieval");
    } else {
      print("   ✅ Retrieval system has been used");
    }
  } catch (err) {
    print("   ❌ Failed to check retrieval history");
    print(`   - Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  print();

  print("=".repeat(60));
  print("SUMMARY");
  print("=".repeat(60));

  if (!providerInfo.available) {
    print("⚠️  CONFIGURATION INCOMPLETE");
    print();
    print("Required actions:");
    print("1. Set OPENAI_API_KEY in .env file");
    print("2. Restart the server");
    print("3. Run this script again to verify");
    print();
    print("Example:");
    print('  echo "OPENAI_API_KEY=sk-..." >> .env');
    return { ok: false, exitCode: 1 };
  }

  print("✅ CONFIGURATION COMPLETE");
  print();
  print("The retrieval system is ready to use.");
  print("Create an issue and assign it to trigger brief generation.");
  return { ok: true, exitCode: 0 };
}
