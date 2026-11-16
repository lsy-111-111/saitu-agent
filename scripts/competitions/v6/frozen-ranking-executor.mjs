import { createHash, randomUUID } from 'node:crypto';
export const METHODS = Object.freeze({ A0: 'historical_v5', A1: 'rules', B: 'bm25_e5_rrf', C: 'llm' });
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  throw new Error('non_json_binding');
}
export const canonicalHash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function deriveRunSeed(seed, profileId, repetition) { return createHash('sha256').update(`${seed}:${profileId}:${repetition}`).digest().readUInt32LE(0); }
export function seededShuffle(values, seed) {
  const result = [...values]; let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) { state = (Math.imul(1664525, state) + 1013904223) >>> 0; const j = Math.floor(state / 4294967296 * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function generationStatus(report, requestedMethod) {
  if (report.fallback.used) { const reason = report.fallback.reason ?? ''; return reason.includes('timeout') ? 'timeout' : /invalid|unsupported|incomplete|context_budget/.test(reason) ? 'validation_failed' : 'provider_error'; }
  return !report.recommendations.length ? 'empty' : report.trace.method === requestedMethod ? 'ok' : 'provider_error';
}
/** Count recommendation invocations, never match/verify/repair stages. Dispatch events are the HTTP denominator. */
export function summarizeBoundRuns(observations) {
  const ids = observations.map(row => row.invocationId);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('duplicate_or_missing_invocation_id');
  const recommendationRuns = observations.filter(row => row.operation === 'recommend');
  for (const row of recommendationRuns) {
    const dispatches = row.events.filter(event => event.type === 'ai_transport_dispatch').length;
    if (row.execution.httpDispatches !== dispatches || row.execution.actualModelRun !== (dispatches > 0)) throw new Error('model_run_dispatch_evidence_mismatch');
  }
  return { recommendationRuns: recommendationRuns.length,
    actualModelRuns: recommendationRuns.filter(row => row.execution.actualModelRun).length,
    httpDispatches: recommendationRuns.reduce((n, row) => n + row.execution.httpDispatches, 0),
    successfulCRuns: recommendationRuns.filter(row => row.algorithm === 'C' && row.execution.actualModelRun && row.status === 'observed' && !row.fallback && row.execution.modelStatus === 'ok').length,
    fallbackRuns: recommendationRuns.filter(row => row.fallback).length };
}
/** Server-side harness only: callers supply an already validated canonical context, never HTTP trust data. */
export async function executeFrozenRanking({algorithm, profile, context, input = {profile}, caseId, profileId, familyId, taskGroup, repetition, seed, effort = 'max', freezeBinding = {}, modules, embeddingProvider, onStage, onAccountingEvent, invocationId = randomUUID()}) {
  if (!['A1','B','C'].includes(algorithm)) throw new Error('unregistered_ranking_algorithm');
  if (!Number.isInteger(repetition) || repetition < 1 || repetition > 5) throw new Error('ranking_requires_five_repetitions');
  if (canonicalHash(input.profile) !== canonicalHash(profile)) throw new Error('ranking_input_profile_mismatch');
  const {engine, model, hybrid, validation, productObservation} = modules;
  const started = Date.now(), stages = [], events = [];
  const inputSha256 = canonicalHash(input), contextSha256 = canonicalHash(JSON.parse(JSON.stringify(context)));
  const shuffleSeed = deriveRunSeed(seed, profileId, repetition), candidates = seededShuffle(context.candidates, shuffleSeed);
  const candidateOrder = candidates.map(c => c.record.recordId);
  if (new Set(candidateOrder).size !== candidateOrder.length) throw new Error('duplicate_frozen_candidate');
  const experiment = {candidateItemIds: [...candidateOrder], candidateOrder, shuffleSeed, skipIndependentRecall: true, reasoningEffort: effort};
  let report = null, retrieval = null, error = null;
  const event = (type, origin, details) => events.push({seq: events.length + 1,time:new Date().toISOString(),type,requestId:invocationId,origin,details});
  event('candidate_pool_frozen','transport',{candidateOrder,shuffleSeed,skipIndependentRecall:true});
  try {
    report = await productObservation.withProductObservation({observer: e => { event(e.type,'product',e.details); onAccountingEvent?.(e); }}, async () => {
      if (algorithm === 'C') return model.runDecisionRecommendation(profile,{method:'llm',context,experiment,onObservation: async e => {stages.push(e);await onStage?.(e);}});
      let ranked = {...context,candidates};
      if (algorithm === "A1") ranked = {...context,candidates:[...candidates].sort(engine.compareRuleCandidates)};
      if (algorithm === 'B') {
        if (!embeddingProvider) throw new Error('pinned_e5_required');
        const query = context.profile.facts.filter(f => f.confirmed && f.state === 'affirmed').map(f => `${f.field}: ${f.label} ${JSON.stringify(f.value)}`).join('\n');
        retrieval = await hybrid.rankHybridCandidates({query:query || '新手探索任务与准备路径',embeddingProvider,documents:candidates.map(c => ({itemId:c.record.recordId,text:JSON.stringify({name:c.record.name,tasks:c.record.sections.task,deliverables:c.record.sections.deliverables,roles:c.record.roles,skills:c.record.skills,values:c.record.valueDimensions})})),skipIndependentRecall:true});
        retrieval = hybrid.rerankHybridCandidates(retrieval,candidates.map(c => ({itemId:c.record.recordId,dimensions:c.nativeScore?.dimensions??[],unknowns:(c.nativeScore?.dimensions??[]).filter(d => d.lower!==d.upper).map(d=>d.name)})));
        if (canonicalHash([...retrieval.itemIds].sort()) !== canonicalHash([...candidateOrder].sort())) throw new Error('hybrid_changed_frozen_pool');
        const order = new Map(retrieval.itemIds.map((id,i)=>[id,i]));
        ranked = {...context,candidates:[...candidates].sort((a,b)=>order.get(a.record.recordId)-order.get(b.record.recordId))};
      }
      const result = engine.assembleDecisionReport(context,engine.buildRuleMatchPlan(ranked),{method:algorithm==='B'?'hybrid':'rules',model:algorithm==='B'?embeddingProvider.model:'server',promptVersion:algorithm==='B'?'bm25-e5-rrf.v1':'A1-fair-rule.v1',callCount:0,inputTokens:null,outputTokens:null,costCny:0,elapsedMs:Date.now()-started});
      if (!validation.validateDecisionReport(result,context).ok) throw new Error('invalid_baseline_report');
      return result;
    });
  } catch {error = 'execution_failed_no_valid_report';}
  if (canonicalHash(JSON.parse(JSON.stringify(context))) !== contextSha256) throw new Error('frozen_context_changed');
  report = report === null ? null : JSON.parse(JSON.stringify(report));
  const outputSha256 = canonicalHash(report), reservationIds = [...new Set(events.filter(e=>['ai_budget_reserved','ai_budget_settled','ai_settlement_failed'].includes(e.type)).map(e=>e.details.reservationId).filter(Boolean))];
  const dispatches = events.filter(e=>e.type==='ai_transport_dispatch');
  const modelStatus = report ? generationStatus(report,algorithm==='B'?'hybrid':METHODS[algorithm]) : 'validation_failed';
  const binding = {invocationId,inputSha256,outputSha256,reservationIds,freezeBinding,candidateSetSha256:canonicalHash([...candidateOrder].sort())};
  event('response_received','transport',{outputSha256});
  const execution = {actualModelRun:dispatches.length>0,httpDispatches:dispatches.length,modelStatus};
  const observation = {caseId:caseId??profileId,operation:'recommend',adapterVersion:'saitu-frozen-ranking.v1',status:report?'observed':'error',output:report,error,fallback:report?.fallback.used??false,elapsedMs:Date.now()-started,events,usage:events.filter(e=>e.type.startsWith('ai_')),productBinding:[],capabilities:['frozen_full_candidate_ranking'],algorithm,profileId,repetition:repetition-1,...binding,execution};
  const ranking = {algorithm,profileId,runId:invocationId,modelStatus,displayedItemIds:report?.recommendations.map(r=>r.itemId)??[],fallbackUsed:observation.fallback,...binding};
  return {report,observation,ranking,stages,retrieval,shuffleSeed,candidateOrder,errorCode:error,elapsedMs:Date.now()-started};
}

/** Fail closed before any paid work: a selected-arm observation is copied, never regenerated. */
export function validateReusableRanking({observation,ranking,input,algorithm,repetition,freezeBinding}) {
  const equal = (a,b) => canonicalHash(a) === canonicalHash(b);
  if (observation.operation !== 'recommend' || observation.algorithm !== algorithm || ranking.algorithm !== algorithm || ranking.profileId !== observation.profileId || ranking.runId !== observation.invocationId || observation.repetition !== repetition || !equal(observation.freezeBinding,freezeBinding)) throw new Error('ranking_reuse_configuration_mismatch');
  if (observation.inputSha256 !== canonicalHash(input) || observation.outputSha256 !== canonicalHash(observation.output)) throw new Error('ranking_reuse_input_or_output_mismatch');
  for (const key of ['invocationId','inputSha256','outputSha256','reservationIds','freezeBinding','candidateSetSha256']) if (!equal(observation[key],ranking[key])) throw new Error('ranking_reuse_artifact_binding_mismatch');
  if (!equal(ranking.displayedItemIds,observation.output?.recommendations.map(r=>r.itemId)??[]) || ranking.fallbackUsed !== observation.fallback || ranking.modelStatus !== observation.execution.modelStatus) throw new Error('ranking_reuse_display_mismatch');
  return observation;
}
