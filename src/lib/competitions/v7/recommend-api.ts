import "server-only";
import { competitionAiJson } from "@/lib/ai/competition-api";
import { recordAiConsent } from "@/lib/ai/consent";
import { getConfiguredAiProvider } from "@/lib/ai/ai-client";
import type { CompetitionConversationTokenV6 } from "@/lib/ai/competition-conversation-token";
import type { CompetitionRecommendRequestV5 } from "@/lib/ai/competition-request-schema";
import { competitionTransitionId, executeCompetitionSessionTransition } from "@/lib/security/rate-limit";
import { mergeQuestionnaireEdits, projectProfileToLegacy } from "../v6/profile";
import { verifyDecisionTokenV7 } from "./crypto";
import { buildDecisionContextV7 } from "./model";
import { enqueueRunV7, findSubmittedRunV7, presentRunV7, readSessionV7, submissionKeyV7 } from "./store";
import { RECOMMENDATION_IMPLEMENTATION_VERSION, RECOMMENDATION_POLICY_VERSION } from "./contracts";
import { readSubmissionTimingV7, attachSubmissionTimingV7 } from "./submission-timing";

export async function recommendV7(request:Request,requestId:string,input:CompetitionRecommendRequestV5,conversation:CompetitionConversationTokenV6) {
  const timing = readSubmissionTimingV7(request);
  const transition=competitionTransitionId("competition_recommend_v7",{...input,policyVersion:RECOMMENDATION_POLICY_VERSION,implementationVersion:RECOMMENDATION_IMPLEMENTATION_VERSION});
  return executeCompetitionSessionTransition({request,requestId,operation:"competition_recommend",sessionId:conversation.sessionId,
    sessionExpiresAtEpochSeconds:conversation.expiresAt,transitionId:transition,producer:async producer=>{
      try{
        let profile,legacy=conversation.profile,sessionId=conversation.sessionId,expiresAt=conversation.expiresAt*1000;
        const previous=input.decisionEdit?verifyDecisionTokenV7(input.decisionEdit.decisionToken):null;
        const submissionKey=submissionKeyV7(previous?.sessionId??sessionId,{transition});
        if(input.decisionEdit){
          if(!previous)return competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401});
          const saved=await readSessionV7(previous,{allowStale:true});if(!saved)return competitionAiJson({ok:false,error:"DECISION_SESSION_EXPIRED"},{status:401});
          const replay=await findSubmittedRunV7(submissionKey,saved);
          if(replay)return competitionAiJson(presentRunV7(replay,saved),{status:202});
          if(saved.generation!==previous.generation||saved.profile.revision!==input.decisionEdit.expectedRevision)return competitionAiJson({ok:false,error:"DECISION_REVISION_CHANGED"},{status:409});
          profile=mergeQuestionnaireEdits(saved.profile,conversation.profile,input.decisionEdit.changedFields,{answerId:`edit-${transition}`,at:new Date().toISOString(),answerContext:conversation.rawAnswerContext});
          legacy=projectProfileToLegacy(profile,conversation.profile,{openDomain:true});sessionId=saved.sessionId;expiresAt=saved.expiresAt;
        }
        const context=buildDecisionContextV7(legacy,{profile,profileId:sessionId,now:new Date(),transcript:conversation.transcript,answerContext:conversation.rawAnswerContext,answeredAt:new Date(conversation.issuedAt*1000).toISOString()});
        await recordAiConsent(request,"competition_recommend",{provider:getConfiguredAiProvider(),model:"deepseek-flash"},{deadlineEpochMs:producer.deadlines.producerDeadlineEpochMs,signal:producer.signal});
        if(producer.signal.aborted)throw new Error("DECISION_TIMEOUT");
        const queued=await enqueueRunV7({sessionId,expiresAt,legacy,context,submissionKey,submittedAtEpochMs:timing.submittedAtEpochMs,
          ...(previous?{previous,expectedRevision:input.decisionEdit!.expectedRevision}:{})});
        return attachSubmissionTimingV7(request,competitionAiJson(presentRunV7(queued.run,queued.session),{status:202}));
      }catch(error){
        const code=error instanceof Error?error.message:"DECISION_STATE_UNAVAILABLE";
        if(["DECISION_REVISION_CHANGED","DECISION_SESSION_EXPIRED"].includes(code))return competitionAiJson({ok:false,error:code},{status:409});
        return competitionAiJson({ok:false,error:"DECISION_STATE_UNAVAILABLE"},{status:503});
      }
    }});
}
