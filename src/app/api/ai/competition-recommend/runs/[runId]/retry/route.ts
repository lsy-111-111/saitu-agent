import {z} from "zod";
import {competitionAiJson,readCompetitionAiJson,competitionAiRequestErrorResponse,COMPETITION_AI_MAX_REQUEST_BYTES} from "@/lib/ai/competition-api";
import {hasValidAiConsent,aiConsentRequiredResponse,recordAiConsent} from "@/lib/ai/consent";
import {getConfiguredAiProvider} from "@/lib/ai/ai-client";
import {competitionTransitionId,executeCompetitionSessionTransition,getRequestId,rejectLargeRequest,withRequestId} from "@/lib/security/rate-limit";
import {isCompetitionRecommenderEnabled} from "@/lib/config/features";
import {verifyDecisionTokenV7} from "@/lib/competitions/v7/crypto";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {readSubmissionTimingV7} from "@/lib/competitions/v7/submission-timing";
import {enqueueRunV7,findSubmittedRunV7,presentRunV7,readRunV7,readSessionV7,submissionKeyV7} from "@/lib/competitions/v7/store";
import {RECOMMENDATION_DETAIL_DEADLINE_MS,RECOMMENDATION_IMPLEMENTATION_VERSION,RECOMMENDATION_POLICY_VERSION} from "@/lib/competitions/v7/contracts";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const retrySchema=z.object({decisionToken:z.string().min(32).max(4096),expectedRevision:z.string().min(1).max(180),requestId:z.string().min(12).max(100).regex(/^[a-zA-Z0-9_-]+$/),aiConsent:z.object({accepted:z.literal(true),version:z.string().min(1).max(120)}).strict()}).strict();
/** An explicit new attempt is distinct from resuming an uncertain old call. */
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const requestId=getRequestId(request),respond=(response:Response)=>withRequestId(response,requestId);
  let timing;
  try { timing=readSubmissionTimingV7(request); }
  catch { return respond(competitionAiJson({ok:false,error:"DECISION_TIMING_INVALID"},{status:400})); }
  if(!isCompetitionRecommenderEnabled())return respond(competitionAiJson({ok:false,error:"COMPETITION_RECOMMENDER_DISABLED"},{status:503}));
  const oversized=rejectLargeRequest(request,COMPETITION_AI_MAX_REQUEST_BYTES);if(oversized)return respond(oversized);
  const raw=await readCompetitionAiJson(request);if(!raw.ok)return respond(competitionAiRequestErrorResponse(raw.error));
  if(!hasValidAiConsent(raw.value))return respond(aiConsentRequiredResponse());
  const parsed=retrySchema.safeParse(raw.value),{runId}=await params;
  if(!parsed.success||!z.string().uuid().safeParse(runId).success)return respond(competitionAiJson({ok:false,error:"INVALID_INPUT"},{status:400}));
  const input=parsed.data,token=verifyDecisionTokenV7(input.decisionToken);
  if(!token)return respond(competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401}));
  return executeCompetitionSessionTransition({request,requestId,operation:"competition_recommend",sessionId:token.sessionId,sessionExpiresAtEpochSeconds:Math.floor(token.expiresAt/1000),
    transitionId:competitionTransitionId("competition_retry_v7",{runId,...input,policyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION}),producer:async producer=>{
      try{
        const session=await readSessionV7(token,{allowStale:true});if(!session)return competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401});
        const key=submissionKeyV7(session.sessionId,{retryRunId:runId,requestId:input.requestId,baseRevision:input.expectedRevision});
        const replay=await findSubmittedRunV7(key,session);if(replay)return competitionAiJson(presentRunV7(replay,session),{status:202});
        if(session.currentRunId!==runId||session.generation!==token.generation||session.profile.revision!==input.expectedRevision)return competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED"},{status:409});
        const previous=await readRunV7(runId);if(!previous||previous.row.state_key!==session.id)return competitionAiJson({ok:false,error:"DECISION_RUN_NOT_FOUND"},{status:404});
        if(previous.row.status!=="failed")return competitionAiJson({ok:false,error:"DECISION_RUN_NOT_FAILED"},{status:409});
        if(session.expiresAt<timing.submittedAtEpochMs+RECOMMENDATION_DETAIL_DEADLINE_MS+15_000)return competitionAiJson({ok:false,error:"DECISION_SESSION_RENEWAL_REQUIRED"},{status:409});
        await recordAiConsent(request,"competition_recommend",{provider:getConfiguredAiProvider(),model:"deepseek-flash"},{signal:producer.signal,deadlineEpochMs:producer.deadlines.producerDeadlineEpochMs});
        if(producer.signal.aborted)return competitionAiJson({ok:false,error:"DECISION_TIMEOUT"},{status:503});
        const context=buildDecisionContextV7(session.legacy,{profile:session.profile});
        const created=await enqueueRunV7({sessionId:session.sessionId,expiresAt:session.expiresAt,legacy:session.legacy,context,submissionKey:key,previous:token,expectedRevision:input.expectedRevision,history:session.history,submittedAtEpochMs:timing.submittedAtEpochMs});
        return competitionAiJson(presentRunV7(created.run,created.session),{status:202});
      }catch(error){
        const message=error instanceof Error?error.message:"";
        const code=message==="DECISION_REVISION_CHANGED"?message:message==="DECISION_SESSION_EXPIRED"?"DECISION_SESSION_RENEWAL_REQUIRED":"DECISION_STATE_UNAVAILABLE";
        return competitionAiJson({ok:false,error:code},{status:code==="DECISION_STATE_UNAVAILABLE"?503:409});
      }
    }});
}
