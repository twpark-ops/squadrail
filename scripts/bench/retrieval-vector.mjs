#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "../../node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/index.js";

const DEFAULT_DATABASE_URL = "postgres://squadrail:squadrail@127.0.0.1:54329/squadrail";
const ROLLBACK_SENTINEL = "__SQUADRAIL_VECTOR_BENCH_ROLLBACK__";

function parseNumberFlag(name, fallback) {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  const parsed = Number(match?.slice(name.length + 3));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseDatabaseUrl() {
  const flag = process.argv.find((value) => value.startsWith("--database-url="));
  return flag?.slice("--database-url=".length)
    ?? process.env.DATABASE_URL
    ?? process.env.SQUADRAIL_DATABASE_URL
    ?? DEFAULT_DATABASE_URL;
}

function redactDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = "******";
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function embedding(seed, dimensions = 1536) {
  return Array.from({ length: dimensions }, (_, index) =>
    Number((((seed + 17) * (index + 11)) % 1009) / 1009).toFixed(6),
  );
}

function cosine(left, right) {
  const size = Math.min(left.length, right.length);
  if (size === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? dot / denominator : 0;
}

async function benchmarkVectors(sql, input) {
  const companyId = randomUUID();
  const documentIds = Array.from({ length: input.sampleSize }, () => randomUUID());
  let appSide = { total: 0, average: 0 };
  let dbVector = { total: null, average: null };

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into companies (
          id, name, description, status, issue_prefix, issue_counter, budget_monthly_cents, spent_monthly_cents,
          require_board_approval_for_new_agents
        ) values (
          ${companyId}, 'Vector Bench', 'Temporary retrieval benchmark tenant', 'active', 'VEC', 0, 0, 0, true
        )
      `;

      for (let index = 0; index < input.sampleSize; index += 1) {
        const documentId = documentIds[index];
        await tx`
          insert into knowledge_documents (
            id, company_id, source_type, authority_level, content_sha256, metadata, raw_content, title, path
          ) values (
            ${documentId},
            ${companyId},
            'code',
            'canonical',
            ${checksum(`doc-${index}`)},
            '{}'::jsonb,
            ${`export function sample${index}(){ return ${index}; }`},
            ${`Sample ${index}`},
            ${`src/sample-${index}.ts`}
          )
        `;

        await tx`
          insert into knowledge_chunks (
            company_id, document_id, chunk_index, token_count, text_content, search_tsv, embedding, metadata
          ) values (
            ${companyId},
            ${documentId},
            0,
            64,
            ${`sample chunk ${index}`},
            to_tsvector('simple', ${`sample chunk ${index}`}),
            ${JSON.stringify(embedding(index))}::jsonb,
            '{}'::jsonb
          )
        `;
      }

      if (input.pgvectorInstalled) {
        await tx`
          update knowledge_chunks
          set embedding_vector = embedding::text::vector
          where company_id = ${companyId}
        `;
      }

      const storedRows = await tx`
        select id, embedding
        from knowledge_chunks
        where company_id = ${companyId}
      `;
      const vectors = storedRows.map((row) => ({
        id: row.id,
        embedding: Array.isArray(row.embedding) ? row.embedding : [],
      }));
      const queryEmbeddings = Array.from({ length: input.queryCount }, (_, index) => embedding(index + 1000));

      const appStart = performance.now();
      for (const queryEmbedding of queryEmbeddings) {
        vectors
          .map((row) => ({
            id: row.id,
            score: cosine(row.embedding, queryEmbedding),
          }))
          .sort((left, right) => right.score - left.score)
          .slice(0, 10);
      }
      const appElapsed = performance.now() - appStart;
      appSide = {
        total: Number(appElapsed.toFixed(3)),
        average: Number((appElapsed / input.queryCount).toFixed(3)),
      };

      if (input.pgvectorInstalled) {
        const dbStart = performance.now();
        for (const queryEmbedding of queryEmbeddings) {
          const vectorLiteral = `[${queryEmbedding.join(",")}]`;
          await tx.unsafe(
            `select id, 1 - (embedding_vector <=> '${vectorLiteral}'::vector) as score
             from knowledge_chunks
             where company_id = $1
               and embedding_vector is not null
             order by embedding_vector <=> '${vectorLiteral}'::vector
             limit 10`,
            [companyId],
          );
        }
        const dbElapsed = performance.now() - dbStart;
        dbVector = {
          total: Number(dbElapsed.toFixed(3)),
          average: Number((dbElapsed / input.queryCount).toFixed(3)),
        };
      }

      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) {
      throw error;
    }
  }

  return { appSide, dbVector };
}

async function main() {
  const databaseUrl = parseDatabaseUrl();
  const sampleSize = parseNumberFlag("sample-size", 96);
  const queryCount = parseNumberFlag("query-count", 12);
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

  try {
    const [vectorRow] = await sql`
      select
        exists(select 1 from pg_extension where extname = 'vector') as installed,
        exists(
          select 1
          from pg_indexes
          where schemaname = 'public'
            and indexname = 'knowledge_chunks_embedding_vector_hnsw_idx'
        ) as index_ready
    `;
    const pgvectorInstalled = Boolean(vectorRow?.installed ?? false);
    const indexReady = Boolean(vectorRow?.index_ready ?? false);
    const result = await benchmarkVectors(sql, {
      sampleSize,
      queryCount,
      pgvectorInstalled,
    });

    console.log(JSON.stringify({
      databaseUrl: redactDatabaseUrl(databaseUrl),
      checkedAt: new Date().toISOString(),
      sampleSize,
      queryCount,
      pgvector: {
        installed: pgvectorInstalled,
        indexReady,
      },
      appSideCosineMs: result.appSide,
      dbVectorMs: result.dbVector,
    }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
