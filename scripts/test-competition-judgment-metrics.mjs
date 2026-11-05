import assert from "node:assert/strict";
import {positiveJudgmentMetrics} from "./competition-judgment-metrics.mjs";
assert.deepEqual(positiveJudgmentMetrics(["A","X","Y"],["A","B","C","D"],3),{hit:1,recall:.25,hits:1});
assert.deepEqual(positiveJudgmentMetrics(["A","A"],["A","B"],2),{hit:1,recall:.5,hits:1});
assert.deepEqual(positiveJudgmentMetrics([],[],3),{hit:null,recall:null,hits:0});
console.log("ECASE14: Hit@K and known-positive Recall@K distinguish single, repeated and empty cases.");
