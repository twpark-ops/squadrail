import type { RetrievalHitView, RetrievalPolicyRerankConfig } from "../issue-retrieval.js";

export function applyModelRerankOrder(input: {
  hits: RetrievalHitView[];
  rankedChunkIds: string[];
  finalK: number;
  modelRerank: RetrievalPolicyRerankConfig["modelRerank"];
}) {
  if (input.rankedChunkIds.length === 0) return input.hits.slice(0, input.finalK);

  const rankByChunkId = new Map<string, number>();
  const maxBaseFusedScore = input.hits.reduce((max, hit) => Math.max(max, hit.fusedScore), 0);
  input.rankedChunkIds.forEach((chunkId, index) => {
    if (!rankByChunkId.has(chunkId)) rankByChunkId.set(chunkId, index);
  });

  return input.hits
    .map((hit) => {
      const rank = rankByChunkId.get(hit.chunkId);
      if (rank == null) return hit;
      const modelBoost = Math.max(0, input.modelRerank.baseBoost - rank * input.modelRerank.decay);
      const priorityScore =
        maxBaseFusedScore
        + input.modelRerank.baseBoost
        - rank * Math.max(0.01, input.modelRerank.decay);
      const fusedScore = Math.max(hit.fusedScore + modelBoost, priorityScore);
      return {
        ...hit,
        rerankScore: (hit.rerankScore ?? 0) + (fusedScore - hit.fusedScore),
        fusedScore,
        modelRerankRank: rank + 1,
      } satisfies RetrievalHitView;
    })
    .sort((left, right) => {
      const leftRank = rankByChunkId.get(left.chunkId);
      const rightRank = rankByChunkId.get(right.chunkId);
      if (leftRank != null || rightRank != null) {
        if (leftRank == null) return 1;
        if (rightRank == null) return -1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.finalK);
}
