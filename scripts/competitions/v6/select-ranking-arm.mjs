import { createHash } from "node:crypto";
import { readFile,realpath,writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceManifest } from "./run-experiment.mjs";
import { canonicalHash,summarizeBoundRuns } from "./frozen-ranking-executor.mjs";
import { loadRankingReuse } from "./ranking-reuse.mjs";
import { mergeOriginalPoolReviews } from "./acceptance-raw-scoring.ts";
import { inspectChallengeManifest } from "./acceptance-gate.ts";
import { evaluateRankings,pairedFamilyBootstrap } from "./evaluate-rankings.ts";
import { ordinalAgreement } from "./reviewer-agreement.ts";
import { readDevelopmentSelection } from "./select-development-baseline.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export function eligibleForRankingReuse(arm, familyResults) {
  const groups=new Map();
  for (const row of familyResults.filter(r=>r.algorithm===arm.algorithm)) {
    const group=groups.get(row.taskGroup)??[];
    group.push(row.pooledNdcg5);groups.set(row.taskGroup,group);
  }
  return arm.aiProxyAcceptanceEligible && arm.actualRunCount===600 && arm.scoredFamilyCount===120 &&
    arm.pooledNdcg5>=0.85 && arm.pooledNdcg10>=0.80 && arm.top5SeriesJaccard>=0.80 && groups.size===6 &&
    [...groups.values()].every(values=>values.length===20 && values.every(Number.isFinite) &&
      values.reduce((a,b)=>a+b,0)/values.length>=0.75);
}
export function chooseRankingArm(ranking,control,agreement,execution) {
  if (!(agreement.value!==null && agreement.value>=0.70) || agreement.paired<2)
    return {status:"incomplete_or_failed_original_agreement",selectedForReuse:null};
  const controls=ranking.summaries.filter(a=>a.algorithm!=="C" && eligibleForRankingReuse(a,ranking.profileResults));
  controls.sort((a,b)=>b.pooledNdcg5-a.pooledNdcg5 || b.pooledNdcg10-a.pooledNdcg10 || a.algorithm.localeCompare(b.algorithm));
  const candidate=ranking.summaries.find(a=>a.algorithm==="C"), base=ranking.summaries.find(a=>a.algorithm===control);
  if(!candidate || !base) throw Error("missing_registered_arm");
  const pairs=arm=>arm.families.filter(r=>r.pooledNdcg5!==null).map(r=>({familyId:r.familyId,value:r.pooledNdcg5}));
  const cf=pairs(candidate),bf=pairs(base);
  const paired=cf.length===120 && bf.length===120 ? pairedFamilyBootstrap(cf,bf,2000,6141) : null;
  if(execution.actualModelRuns===600 && eligibleForRankingReuse(candidate,ranking.profileResults) && paired?.meanDifference>=0.03 && paired.interval[0]>0)
    return {status:"rank_eligible",selectedForReuse:"C",paired};
  const selected=controls.find(r=>r.algorithm===control)??controls[0];
  return {status:selected?"rank_eligible":"no_arm_meets_ranking_gates",selectedForReuse:selected?.algorithm??null,paired};
}
async function main(){
  const [open,bundlePath,expectedHash,output]=process.argv.slice(2);
  if(open!=="--open"||!/^[0-9a-f]{64}$/.test(expectedHash)||!output) throw Error("usage_--open_BUNDLE_SHA_NEW_RESULT");
  const bytes=await readFile(bundlePath);if(sha(bytes)!==expectedHash) throw Error("ranking_selection_bundle_changed");
  const bundle=JSON.parse(bytes),root=await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../.."));
  if(bundle.schemaVersion!=="saitu.before-reuse-selection.v1") throw Error("unsupported_ranking_selection_bundle");
  async function verified(ref){
    if(!ref || path.isAbsolute(ref.path) || !/^[0-9a-f]{64}$/.test(ref.sha256)) throw Error("invalid_selection_reference");
    const resolved=await realpath(path.resolve(root,ref.path));if(!resolved.startsWith(root+path.sep))throw Error("selection_reference_outside_root");
    const raw=await readFile(resolved);if(sha(raw)!==ref.sha256)throw Error("selection_original_changed");return {raw,resolved};
  }
  const challenge=JSON.parse((await verified(bundle.challenge)).raw);
  const problems=inspectChallengeManifest(challenge);if(problems.length)throw Error("invalid_independent_challenge:"+problems.join(","));
  if(!challenge.openedAt)throw Error("challenge_must_already_be_open_for_registered_matrix");
  const freeze=await verified(bundle.matrixFreeze),manifest=JSON.parse(freeze.raw),binding=manifest.freezeBinding;
  if(binding.challengeManifestSha256!==bundle.challenge.sha256 || challenge.implementationSha256!==binding.implementationSha256 ||
     challenge.configurationSha256!==binding.configurationSha256)throw Error("selection_challenge_binding_changed");
  const matrix=await loadRankingReuse({directory:path.dirname(freeze.resolved),freezeManifestSha256:bundle.matrixFreeze.sha256,algorithm:"A1",
    implementationSha256:canonicalHash(await sourceManifest(root)),catalogSha256:binding.catalogSha256,challengeManifestSha256:bundle.challenge.sha256,
    sourceSnapshotSha256:binding.sourceSnapshotSha256,asOf:bundle.asOf,seed:manifest.seed});
  const control=matrix.registration.config.baselineSelection;
  if(!control || !(Date.parse(matrix.registration.registeredAt)<=Date.parse(challenge.openedAt)))throw Error("missing_or_late_baseline_registration");
  const chosen=await readDevelopmentSelection(root,control);
  if(chosen.algorithm!==control.algorithm) throw Error("different_primary_baseline");
  const reviews=(await verified(bundle.rankingReviews)).raw.toString("utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line));
  const byId=new Map(matrix.profileSnapshot.profiles.map(p=>[p.profileId,p]));
  const pools=mergeOriginalPoolReviews(matrix.originalRankingInput.profiles,reviews,byId,challenge,binding.sourceSnapshotSha256);
  const pairs=[];
  for(const pool of pools){
    const originals=reviews.filter(r=>r.profileId===pool.profileId);
    const ratings=role=>new Map((originals.find(r=>r.role===role)?.judgments??[]).map(j=>[j.itemId,j.relevance]));
    const a=ratings("reviewer_a"),b=ratings("reviewer_b");
    for(const item of pool.judgments)pairs.push([a.get(item.itemId)??"U",b.get(item.itemId)??"U"]);
  }
  const agreement=ordinalAgreement(pairs),ranking=evaluateRankings({...matrix.originalRankingInput,profiles:pools});
  const execution=summarizeBoundRuns(matrix.originalObservations);
  const decision=chooseRankingArm(ranking,chosen.algorithm,agreement,execution);
  const result={schemaVersion:"saitu.before-reuse-decision.v1",recordedAt:new Date().toISOString(),inputs:bundle,originalAgreement:agreement,
    primaryControl:chosen.algorithm,decision,ranking,execution,
    productionDefaultChanged:false,other680ExecutedByThisCommand:0,qualityAcceptance:false};
  await writeFile(output,JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  if(!decision.selectedForReuse)process.exitCode=2;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
