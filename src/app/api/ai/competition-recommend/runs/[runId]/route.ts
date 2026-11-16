import { z } from "zod";
import { competitionAiJson } from "@/lib/ai/competition-api";
import { checkDecisionPollRateLimitV7, getRequestId, rateLimitResponse, withRequestId } from "@/lib/security/rate-limit";
import { verifyDecisionTokenV7 } from "@/lib/competitions/v7/crypto";
import { presentRunV7, readRunV7, readSessionV7 } from "@/lib/competitions/v7/store";
import { isCompetitionRecommenderEnabled } from "@/lib/config/features";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const respond=(value:unknown,status=200)=>withRequestId(competitionAiJson(value,{status}),getRequestId(request));
  if(!isCompetitionRecommenderEnabled())return respond({ok:false,error:"COMPETITION_RECOMMENDER_DISABLED"},503);
  const pollLimit=await checkDecisionPollRateLimitV7(request);
  if(!pollLimit.ok)return rateLimitResponse(pollLimit.resetAt,{request,requestId:getRequestId(request),bucket:"decision_poll",operation:"competition_recommend_poll"});
  const token=verifyDecisionTokenV7(request.headers.get("authorization")?.replace(/^Bearer /,"")??"");
  const {runId}=await params;
  if(!token)return respond({ok:false,error:"DECISION_SESSION_EXPIRED"},401);
  if(!z.string().uuid().safeParse(runId).success)return respond({ok:false,error:"INVALID_INPUT"},400);
  try{
    const session=await readSessionV7(token);if(!session)return respond({ok:false,error:"DECISION_SESSION_EXPIRED"},401);
    const run=await readRunV7(runId);if(!run||run.row.state_key!==session.id)return respond({ok:false,error:"DECISION_RUN_NOT_FOUND"},404);
    return respond(presentRunV7(run,session));
  }catch(error){return respond({ok:false,error:error instanceof Error&&error.message==="DECISION_REVISION_CHANGED"?"DECISION_REVISION_CHANGED":"DECISION_STATE_UNAVAILABLE"},error instanceof Error&&error.message==="DECISION_REVISION_CHANGED"?409:503);}
}
