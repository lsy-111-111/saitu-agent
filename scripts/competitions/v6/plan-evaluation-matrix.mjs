import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export const MATRIX = Object.freeze([
  {id:'development_tier_calibration',cases:3,repeats:5,paid:true,maxHttpPerInvocation:4,maxRepairsPerInvocation:1},
  {id:'frozen_tier_validation',cases:18,repeats:5,paid:true,maxHttpPerInvocation:4,maxRepairsPerInvocation:1},
  {id:'ranking_A1',cases:120,repeats:5,paid:false},
  {id:'ranking_B',cases:120,repeats:5,paid:false},
  {id:'ranking_C',cases:120,repeats:5,paid:true,maxHttpPerInvocation:4,maxRepairsPerInvocation:1},
  {id:'qualification',cases:300,repeats:1,paid:true},
  {id:'facts',cases:100,repeats:1,paid:true},
  {id:'profile',cases:120,repeats:1,paid:true},
  {id:'conversation',cases:80,repeats:1,paid:true},
  {id:'robustness',cases:80,repeats:1,paid:true},
  {id:'simulation_pilot',cases:12,repeats:1,paid:true},
  {id:'simulation_comparison',cases:60,repeats:2,paid:true},
  {id:'performance',cases:null,repeats:1,paid:true},
  {id:'release_paid_checks',cases:2,repeats:1,paid:true,maxHttpPerInvocation:1},
  {id:'necessary_repairs',cases:null,repeats:1,paid:true},
]);
/** Estimates never constitute invoices or spend authorization. Unknown bounds block readiness. */
export function planEvaluationMatrix(input) {
  if(input.schemaVersion!=='saitu.evaluation-cost-input.v1'||!finite(input.balanceCny)||!finite(input.cumulativeChargedOrHeldCny)||!finite(input.fundedLimitCny)||input.fundedLimitCny===0||input.fundedLimitCny>300||input.totalCapCny!==300)throw new Error('explicit_current_budget_required');
  const remainingCny=Math.max(0,Math.min(input.balanceCny,input.fundedLimitCny-input.cumulativeChargedOrHeldCny,300-input.cumulativeChargedOrHeldCny));
  const rows=MATRIX.map(row=>{
    const estimate=input.estimates?.[row.id],cases=row.cases??estimate?.cases??null;
    if(cases!==null&&(!Number.isSafeInteger(cases)||cases<1))throw new Error('positive_case_count_required');
    const invocations=cases===null?null:cases*row.repeats;
    if(!row.paid)return {...row,cases,invocations,maxHttpDispatches:0,usageEstimatedCny:0,conservativeReservedCny:0,status:'local_no_provider_cost'};
    const maxCalls=row.maxHttpPerInvocation??estimate?.maxHttpPerInvocation??null;
    if(maxCalls!==null&&(!Number.isSafeInteger(maxCalls)||maxCalls<1))throw new Error('positive_http_bound_required');
    if(estimate?.maxHttpPerInvocation!==undefined&&row.maxHttpPerInvocation&&estimate.maxHttpPerInvocation!==row.maxHttpPerInvocation)throw new Error('fixed_http_bound_mismatch');
    const bound=invocations!==null&&maxCalls!==null?invocations*maxCalls:null;
    const evidence=typeof estimate?.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(estimate.evidenceSha256);
    const usage=evidence&&finite(estimate?.usageEstimatePerInvocationCny)&&invocations!==null?invocations*estimate.usageEstimatePerInvocationCny:null;
    const reserved=evidence&&finite(estimate?.reservePerHttpCny)&&bound!==null?bound*estimate.reservePerHttpCny:null;
    return {...row,cases,invocations,maxHttpPerInvocation:maxCalls,maxHttpDispatches:bound,usageEstimatedCny:usage,conservativeReservedCny:reserved,estimateEvidenceSha256:estimate?.evidenceSha256??null,status:usage===null||reserved===null?'pending_measured_usage_and_conservative_bound':'estimated_not_invoice'};
  });
  const sum=key=>rows.every(row=>row[key]!==null)?rows.reduce((n,row)=>n+row[key],0):null;
  const conservativeReservedCny=sum('conservativeReservedCny'),usageEstimatedCny=sum('usageEstimatedCny');
  return {schemaVersion:'saitu.evaluation-cost-plan.v1',createdAt:new Date().toISOString(),rankingReports:1800,rankingCRecommendationRuns:600,selectedArmReportsReused:600,additionalSelectedArmPaidRuns:0,otherSealedCases:680,maxRankingHttpDispatches:2400,rankingRepairLimitPerInvocation:1,remainingCny,usageEstimatedCny,conservativeReservedCny,affordable:conservativeReservedCny===null?null:conservativeReservedCny<=remainingCny,status:conservativeReservedCny===null?'pending_complete_cost_bounds':conservativeReservedCny<=remainingCny?'estimate_fits_no_authorization':'blocked_budget',rows,executed:false,actualUsageCny:null,providerInvoiceCny:null,notes:['HTTP stages are not recommendation runs.','Full 120 x 5 x A1/B/C matrix; selected 600 reused in the 800-case run.','Conservative reserves include repair and repeat verification; usage estimates remain separate.','Missing scenario/call/token evidence remains pending. No paid call is made by this planner.']};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){try{const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--input'||args[2]!=='--output')throw new Error('usage_input_FILE_output_NEW_FILE');const bytes=await readFile(args[1]);const result={...planEvaluationMatrix(JSON.parse(bytes)),inputSha256:createHash('sha256').update(bytes).digest('hex')};await writeFile(args[3],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,output:args[3]}));}catch(e){console.error(e.message);process.exitCode=1;}}
