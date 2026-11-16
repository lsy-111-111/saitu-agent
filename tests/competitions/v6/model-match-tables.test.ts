import { describe, expect, it } from "vitest";
import { compactMatchingTables, expandMatchingTables } from "@/lib/competitions/v6/model-match-tables";
describe("lossless matching tables", () => {
  const candidates = Array.from({length:39}, (_, i) => ({itemId:`c${i}`,conditions:["预算与资格未知"],decisionBounds:{cost:{minimum:100,maximum:null},team:null},roles:[{name:"数据整理",task:"保留全部任务正文",skills:["data"],prerequisite:"learnable"}],facts:Array.from({length:6},(_, j)=>({id:`f${i}-${j}`,field:"track",kind:"official_fact",status:"historical",scope:"固定原范围",textReference:{factId:`f${i}-${j}`}}))}));
  it("restores all 39 rows, nested bounds, scopes, prerequisites and nulls", () => {
    const input={profile:{facts:[{label:"明确不愿编程",state:"negated"}]},candidates};
    const packed=compactMatchingTables(input);
    expect(expandMatchingTables(packed)).toEqual(input);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(Buffer.byteLength(JSON.stringify(input))*.8);
  });
  it("keeps schema identities stable under candidate permutation and rejects missing cells", () => {
    const first=compactMatchingTables({candidates}) as {tableSchemas:unknown;candidates:{rows:unknown[][]}};
    const second=compactMatchingTables({candidates:[...candidates].reverse()}) as {tableSchemas:unknown};
    expect(first.tableSchemas).toEqual(second.tableSchemas);
    first.candidates.rows[0].pop();
    expect(()=>expandMatchingTables(first)).toThrow("matching_table_column_count_mismatch");
  });
});
