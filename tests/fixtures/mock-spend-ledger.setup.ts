import {vi} from "vitest";
// Explicit unit-test adapter. Ordinary Node/Next/CLI never loads this file.
// Integration/live/configured-run paths always exercise the real authority/ledger.
vi.mock("@/lib/ai/spend-ledger",async importOriginal=>{
 const actual=await importOriginal<typeof import("../../src/lib/ai/spend-ledger")>();
 return {...actual,reserveAiSpend:((input:Parameters<typeof actual.reserveAiSpend>[0])=>{
  const pureUnit=process.env.NODE_ENV==="test"&&!process.env.AI_SPEND_RUN_ID&&process.env.RUN_SPEND_LEDGER_POSTGRES_TESTS!=="1"&&process.env.RUN_DEEPSEEK_LIVE!=="1"&&process.env.RUN_DEEPSEEK_NORMALIZE_LIVE!=="1";
  if(pureUnit)return Promise.resolve({ok:true as const,reservation:{id:"explicit-vitest-mocked-reservation",reservedMicros:0,settle:async()=>0}});
  return actual.reserveAiSpend(input);
 })};
});
