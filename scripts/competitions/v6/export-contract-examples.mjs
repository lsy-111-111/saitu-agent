import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installSourceLoader} from '../../lib/load-typescript-source.mjs';

async function main(){
  const args=process.argv.slice(2);
  const published=args.length===3&&args[2]==='--published-catalog';
  if((args.length!==2&&!published)||args[0]!=='--output')throw new Error('new_output_directory_required');
  installSourceLoader();
  const {student,syntheticRecord}=await import('../../../tests/competitions/v6/decision-fixtures.ts');
  const {getDecisionCatalog}=await import('../../../src/lib/competitions/v6/catalog.ts');
  const engine=await import('../../../src/lib/competitions/v6/engine.ts');
  const contracts=await import('../../../src/lib/competitions/v6/contracts.ts');
  const {updateProposalSchema}=await import('../../../src/lib/competitions/v6/chat-contracts.ts');
  const {applyProfileMutations,projectProfileToLegacy}=await import('../../../src/lib/competitions/v6/profile.ts');
  const {validateDecisionRecord}=await import('../../../src/lib/competitions/v6/catalog-validation.ts');
  const {validateMatchPlan,validateDecisionReport}=await import('../../../src/lib/competitions/v6/validation.ts');
  const {invocationSchema,canonicalHash}=await import('../../../src/lib/competitions/v6/evaluation-contracts.ts');
  const now=new Date('2026-11-06T00:00:00Z');
  const records=published?getDecisionCatalog():Array.from({length:6},(_,index)=>{
    const record=syntheticRecord(index+1);
    record.scope=record.sources[0].scope=record.facts[0].scope='合成合同示例专用历史范围';
    record.sources[0].locator='合成合同示例专用来源段落';
    record.roles[0].personalDeliverable='能够逐步复现的数据处理记录';
    if(validateDecisionRecord(record,now).tier!=='L2')throw new Error('synthetic_record_contract_failed');
    return record;
  });
  const legacy=student({taskFormats:['modeling'],interests:['data'],confirmedFields:['stage','taskFormats','interests'],decisionContext:{mode:'quick',experienceStatus:'none',goalResolution:'undecided',budget:{scope:'personal',range:'100-500',maximumYuan:300}}});
  const context=engine.buildDecisionContext(legacy,{now,records,profileId:'synthetic-contract-student'});
  if(!published&&context.candidates.length)throw new Error('unreviewed_synthetic_examples_must_remain_unpublished');
  const plan=contracts.matchPlanSchema.parse(engine.buildRuleMatchPlan(context));
  const report=contracts.decisionReportSchema.parse(engine.buildRuleDecisionReport(legacy,{now,records,profileId:'synthetic-contract-student'}));
  if(published&&report.recommendations.length<2)throw new Error('reviewed_example_requires_nonempty_recommendation_and_comparison');
  const verification=validateDecisionReport(report,context),planCheck=validateMatchPlan(plan,context);
  if(!verification.ok||!planCheck.ok)throw new Error('synthetic_cross_reference_contract_failed');
  const proposal=updateProposalSchema.parse({id:'synthetic-budget-confirmation',baseRevision:report.profile.revision,originalText:'我把个人预算改为100元。',summary:'确认后将个人预算上限改为100元。',mutations:[{operation:'set',field:'budget.maximumYuan',state:'affirmed',value:100,targetFactIds:report.profile.facts.filter(fact=>fact.field==='budget.maximumYuan').map(fact=>fact.id),quote:'我把个人预算改为100元。'}]});
  const after=applyProfileMutations(report.profile,proposal.mutations,{answerId:'synthetic-confirm-update',text:proposal.originalText,at:now.toISOString()},legacy);
  if(projectProfileToLegacy(after,legacy).decisionContext?.budget?.maximumYuan!==100||after.revision===report.profile.revision)throw new Error('synthetic_update_replay_failed');
  const input={profile:legacy},invocation=invocationSchema.parse({caseId:'public-contract-example-only',inputSha256:canonicalHash(input),operation:'recommend',input});
  const examples={competition_record:published?context.candidates.find(c=>c.record.recordId===report.recommendations[0].itemId).record:records[0],student_profile:contracts.studentProfileSchema.parse(report.profile),profile_update:proposal,match_plan:plan,recommendation_report:report,verification_result:verification,benchmark_case:invocation};
  const output=path.resolve(args[1]);await mkdir(output,{recursive:false});const files=[];
  for(const [name,value] of Object.entries(examples)){
    const raw=JSON.stringify(value,null,2)+'\n',filename=`${name}.json`;
    await writeFile(path.join(output,filename),raw,{flag:'wx'});files.push({path:filename,sha256:createHash('sha256').update(raw).digest('hex')});
  }
  const manifest={schemaVersion:'saitu.contract-examples.v1',generatedAt:new Date().toISOString(),synthetic:true,source:published?'simulated public student; canonical reviewed competition content; no private benchmark, personal data or AI calls':'public contract fixtures; no sealed questions or personal data',contracts:7,files,paidCalls:0,publicationBoundary:{syntheticRecordsPublished:false,canonicalReviewedCatalogUsed:published,candidateCount:context.candidates.length,recommendationCount:report.recommendations.length,emptyReportExpected:!published},validation:{schemas:true,planCrossReferences:planCheck,reportCrossReferences:verification,confirmedUpdateReplay:true},limitation:published?'These are interface examples for a simulated public student using existing canonical reviewed content. They demonstrate recommendation, comparison and a confirmed profile update, not a real student, paid model result, private800 result, new content approval or acceptance evidence.': 'These are unpublished synthetic interface examples: their candidate pool and recommendation report are intentionally empty under the real publication gate. They are not competition facts, nonempty recommendation examples, model results, review approvals or acceptance evidence. Profile updates require the real signed server session and explicit confirmation.'};
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,contracts:7,synthetic:true,paidCalls:0}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
