import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRankings } from "./evaluate-rankings.ts";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function selectDevelopmentBaseline(input, review) {
  if (input.purpose !== "development" || JSON.stringify(input.algorithms) !== '["A1","B"]' ||
      input.expectedRunsPerProfile !== 5 || input.profiles.length !== 6 || input.runs.length !== 60 ||
      new Set(input.profiles.map(profile => profile.taskGroup)).size !== 6 ||
      new Set(input.profiles.map(profile => profile.familyId)).size !== 6)
    throw new Error("development_six_families_five_runs_two_arms_required");
  if (review.schemaVersion !== "saitu.public-development-blind-labels.v1" || !review.contextId ||
      !Array.isArray(review.rows)) throw new Error("frozen_blind_development_review_required");
  const labels = new Map();
  for (const row of review.rows) {
    const id = JSON.stringify([row.profileId, row.itemId, row.seriesId]);
    if (labels.has(id) || ![0,1,2,3].includes(row.relevance) || !row.reason?.trim() ||
        !row.profilePointer?.trim() || !row.candidatePointer?.trim())
      throw new Error("duplicate_unresolved_or_unsupported_development_label");
    labels.set(id, row);
  }
  const profiles = input.profiles.map(profile => ({...profile, annotationStatus:"single_reviewed", judgments:profile.judgments.map(item => {
    const id = JSON.stringify([profile.profileId,item.itemId,item.seriesId]), row = labels.get(id);
    if (!row) throw new Error("incomplete_development_pool");
    labels.delete(id);
    return {...item, relevance:row.relevance};
  })}));
  if (labels.size) throw new Error("review_outside_development_pool");
  const result = evaluateRankings({...input,profiles});
  if (result.profileResults.some(profile => profile.status !== "scored") ||
      result.summaries.some(summary => summary.scoredFamilyCount !== 6 || summary.actualRunCount !== 30))
    throw new Error("development_families_not_all_scorable");
  const scores = result.summaries.map(({algorithm,pooledNdcg5,pooledNdcg10}) => ({algorithm,pooledNdcg5,pooledNdcg10}));
  scores.sort((a,b)=>b.pooledNdcg5-a.pooledNdcg5 || b.pooledNdcg10-a.pooledNdcg10 || a.algorithm.localeCompare(b.algorithm));
  return {algorithm:scores[0].algorithm, scores, poolLabels:review.rows.length, families:6, runs:60};
}

// Paths in a signed selection are relative to the project's evidence root.
// Recompute the decision rather than trusting a submitted winner or a scalar.
export function replayDevelopmentSeal(root, seal) {
  const base = realpathSync(root);
  function verified(ref, dir=base) {
    if (!ref || typeof ref.path !== "string" || path.isAbsolute(ref.path) || ref.path.split(/[\\/]/).includes("..") ||
        !/^[0-9a-f]{64}$/.test(ref.sha256)) throw new Error("invalid_baseline_evidence_reference");
    const file=realpathSync(path.resolve(dir,ref.path));
    if (!file.startsWith(dir+path.sep) || !file.startsWith(base+path.sep)) throw new Error("baseline_evidence_outside_root");
    const bytes=readFileSync(file);
    if(hash(bytes)!==ref.sha256) throw new Error("baseline_evidence_digest_mismatch");
    return {json:JSON.parse(bytes),file};
  }
  if (seal.schemaVersion!=="saitu.public-development-baseline.v1") throw new Error("invalid_development_selection_schema");
  const raw=verified(seal.rankings).json, review=verified(seal.blindReview).json;
  const pack=verified(seal.reviewInput), profiles=new Map(), candidates=new Map();
  if(pack.json.purpose!=="public_development_only" || pack.json.expectedPairs!==234 ||
     review.reviewInputSha256!==seal.reviewInput.sha256) throw new Error("public_development_packet_not_bound");
  for(const [name,digest] of Object.entries(pack.json.files)) {
    if(!/^(?:profile|item)\/\d+\.json$/.test(name)) throw new Error("unexpected_public_development_packet_path");
    const item=verified({path:name,sha256:digest},path.dirname(pack.file)).json;
    const isProfile=name.startsWith("profile/"), collection=isProfile?profiles:candidates, id=isProfile?item.profileId:item.recordId;
    if(!id||collection.has(id)) throw new Error("duplicate_development_packet_identity");
    collection.set(id,item);
  }
  function resolvePointer(value,pointer) {
    if(typeof pointer!=="string" || !pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer)) throw new Error("invalid_development_evidence_pointer");
    for(const token of pointer.slice(1).split("/")) {
      const key=token.replaceAll("~1","/").replaceAll("~0","~");
      if(!value || typeof value!=="object" || !Object.hasOwn(value,key) || ["__proto__","prototype","constructor"].includes(key)) throw new Error("missing_development_evidence_pointer");
      value=value[key];
    }
    if(value===null || value==="" || typeof value==="object" && Object.keys(value).length===0) throw new Error("empty_development_evidence_pointer");
  }
  if(profiles.size!==6 || candidates.size!==39 || review.rows?.length!==pack.json.expectedPairs ||
     !raw.profiles.every(p=>p.judgments.length===39)) throw new Error("incomplete_public_development_packet");
  for(const row of review.rows) {
    const profile=profiles.get(row.profileId), candidate=candidates.get(row.itemId);
    if(!profile || candidate?.seriesId!==row.seriesId) throw new Error("development_evidence_identity_mismatch");
    resolvePointer(profile,row.profilePointer); resolvePointer(candidate,row.candidatePointer);
  }
  const derived=selectDevelopmentBaseline(raw,review);
  if(seal.algorithm!==derived.algorithm) throw new Error("development_baseline_not_strongest");
  return derived;
}

export async function readDevelopmentSelection(root, reference) {
  const base=await realpath(root);
  if(!reference || typeof reference.path!=="string" || path.isAbsolute(reference.path) ||
     !/^[0-9a-f]{64}$/.test(reference.sha256)) throw new Error("invalid_baseline_evidence_reference");
  const file=await realpath(path.resolve(base,reference.path));
  if(!file.startsWith(base+path.sep)) throw new Error("baseline_evidence_outside_root");
  const bytes=await readFile(file);
  if(hash(bytes)!==reference.sha256) throw new Error("baseline_evidence_digest_mismatch");
  return replayDevelopmentSeal(base,JSON.parse(bytes));
}

async function main() {
  const [rankingPath,reviewPath,output,packetManifest] = process.argv.slice(2);
  if (!packetManifest) throw new Error("usage_RANKING_INPUT_BLIND_REVIEW_NEW_SELECTION_PUBLIC_PACKET_MANIFEST");
  const [rankings,blindReview,pack]=await Promise.all([readFile(rankingPath),readFile(reviewPath),readFile(packetManifest)]);
  const derived=selectDevelopmentBaseline(JSON.parse(rankings),JSON.parse(blindReview));
  const ref=(name,bytes)=>({path:path.relative(process.cwd(),path.resolve(name)),sha256:hash(bytes)});
  const seal={schemaVersion:"saitu.public-development-baseline.v1",createdAt:new Date().toISOString(),
    rankings:ref(rankingPath,rankings),blindReview:ref(reviewPath,blindReview),reviewInput:ref(packetManifest,pack),...derived};
  replayDevelopmentSeal(process.cwd(),seal);
  await writeFile(output,JSON.stringify(seal,null,2)+"\n",{flag:"wx",mode:0o600});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
