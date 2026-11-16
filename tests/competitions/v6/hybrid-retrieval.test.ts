import { describe, expect, it } from "vitest";
import { bm25Scores, rankHybridCandidates, rerankHybridCandidates, retrievalTokens } from "@/lib/competitions/v6/hybrid-retrieval";

describe("offline strong hybrid baseline", () => {
  it("retrieves Chinese tasks without depending on whitespace", () => {
    expect(retrievalTokens("机械设计")).toContain("设计");
    const scores = bm25Scores("机械设计", [{ itemId: "a", text: "机械结构设计与制造" }, { itemId: "b", text: "英语演讲与翻译" }]);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });
  it("unions lexical and semantic hits; E2 preserves every shared candidate", async () => {
    const documents = [{ itemId: "lexical", text: "software software" }, { itemId: "semantic", text: "build an app" }, { itemId: "other", text: "foreign language" }];
    const vectors: Record<string, number[]> = { "query: software": [1, 0], "passage: software software": [0, 1], "passage: build an app": [1, 0], "passage: foreign language": [-1, 0] };
    const embeddingProvider = { model: "unit-test-vector-provider", revision: "a".repeat(40), embed: async (texts: string[]) => texts.map(text => vectors[text]) };
    const result = await rankHybridCandidates({ query: "software", documents, embeddingProvider, recallPerChannel: 1 });
    expect(new Set(result.itemIds)).toEqual(new Set(["lexical", "semantic"]));
    expect(result.recallApplied).toBe(true);
    const all = await rankHybridCandidates({ query: "software", documents: [...documents].reverse(), embeddingProvider, recallPerChannel: 1, skipIndependentRecall: true });
    expect(all.itemIds).toHaveLength(3);
    expect(all.recallApplied).toBe(false);
    expect(all.itemIds.slice(0, 2)).toEqual(result.itemIds);
  });
  it("fails closed instead of silently replacing an unavailable embedding channel with BM25", async () => {
    await expect(rankHybridCandidates({ query: "task", documents: [{itemId: "a", text: "task"}],
      embeddingProvider: {model: "missing", revision: "a".repeat(40), embed: async () => { throw new Error("missing_local_weights"); }} })).rejects.toThrow("missing_local_weights");
    await expect(rankHybridCandidates({ query: "task", documents: [{itemId: "a", text: "task"}],
      embeddingProvider: {model: "bad", revision: "a".repeat(40), embed: async () => [[0, 0], [1, 0]]} })).rejects.toThrow("zero_embedding_vector");
  });
  it("does not confuse semantic similarity with supported personal suitability", async () => {
    const embeddingProvider = { model: "fixture", revision: "a".repeat(40), embed: async () => [[1,0],[1,0],[0.7,0.3]] };
    const retrieved = await rankHybridCandidates({query:"software",documents:[{itemId:"similar",text:"software"},{itemId:"suitable",text:"project"}],embeddingProvider,skipIndependentRecall:true});
    expect(retrieved.itemIds[0]).toBe("similar");
    const reranked = rerankHybridCandidates(retrieved,[
      {itemId:"similar",dimensions:[{name:"task",weight:100,lower:0,upper:100}],unknowns:["Student task connection unknown"]},
      {itemId:"suitable",dimensions:[{name:"task",weight:100,lower:90,upper:90}],unknowns:[]},
    ]);
    expect(reranked.itemIds[0]).toBe("suitable");
    expect(reranked.scores[1].dimensions[0]).toMatchObject({lower:0,upper:100});
    expect(reranked.scores[1].unknowns).not.toHaveLength(0);
  });
});
