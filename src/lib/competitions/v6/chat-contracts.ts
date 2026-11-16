import { sourceJudgmentSchema,conditionJudgmentSchema } from "./source-judgment-contracts";
import { domainFieldSchema,domainFactSchema } from "./domain-facts";
import { z } from "zod";
import { decisionClaimSchema, decisionReportSchema, comparisonSchema } from "./contracts";
import { profileMutationSchema } from "./profile-contracts";

export const decisionChatRequestSchema = z.object({
  expectedProfileId:z.string().min(1).max(180).optional(),expectedCatalogVersion:z.string().min(1).max(180).optional(),
  decisionToken: z.string().min(32).max(4096), expectedRevision: z.string().min(1).max(180),
  requestId: z.string().min(12).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  aiConsent: z.object({ accepted: z.literal(true), version: z.string().min(1).max(120) }).strict(),
  action: z.discriminatedUnion("type", [
    z.object({type:z.literal("qualify_condition"),itemId:z.string().max(180),target:z.object({kind:z.enum(["student_eligibility","submission_constraint","participation_constraint"]),field:domainFieldSchema}).strict(),question:z.string().max(1200)}).strict(),
    z.object({type:z.literal("extract_profile"),utterance:z.string().min(1).max(1200),requestedFields:z.array(domainFieldSchema).min(1).max(40)}).strict(),
    z.object({type:z.literal("review_conversation"),turns:z.array(z.object({id:z.string().max(80),text:z.string().min(1).max(1200)}).strict()).min(1).max(8),requestedFields:z.array(domainFieldSchema).min(1).max(40)}).strict(),
    z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(1200), selectedItemIds: z.array(z.string().max(180)).max(3).optional() }).strict(),
    z.object({type:z.literal("skip_question"),questionId:z.string().min(1).max(180),disposition:z.enum(["skipped","unknown"])}).strict(),
    z.object({ type: z.literal("answer_question"), questionId: z.string().min(1).max(180), value: z.string().min(1).max(160) }).strict(),
    z.object({ type: z.literal("confirm_update"), proposalId: z.string().min(1).max(100) }).strict(),
    z.object({ type: z.literal("reject_update"), proposalId: z.string().min(1).max(100) }).strict(),
  ]),
}).strict();
export type DecisionChatRequest = z.infer<typeof decisionChatRequestSchema>;
export const updateProposalSchema = z.object({
  id: z.string(), baseRevision: z.string(), originalText: z.string(), summary: z.string().max(1600),
  mutations: z.array(profileMutationSchema).min(1).max(12),
}).strict();
export type DecisionUpdateProposal = z.infer<typeof updateProposalSchema>;
export const decisionChatReplySchema = z.object({
  kind: z.enum(["answer", "comparison", "update_proposal", "report_updated"]),
  message: z.string().min(1).max(1600), claims: z.array(decisionClaimSchema).max(8),
  sourceJudgments:z.array(sourceJudgmentSchema).max(20).optional(),conditionJudgment:conditionJudgmentSchema.optional(),
  extractedFacts:z.array(domainFactSchema).max(160).optional(),
  conversationStates:z.array(z.object({afterTurn:z.union([z.string(),z.number()]),facts:z.array(domainFactSchema).max(160),unknownFields:z.array(domainFieldSchema).max(160),changedFields:z.array(domainFieldSchema).max(160)}).strict()).max(20).optional(),
  comparison: comparisonSchema.optional(), proposal: updateProposalSchema.optional(), report: decisionReportSchema.optional(),
  binding:z.object({requestId:z.string(),profileId:z.string(),baseRevision:z.string(),profileRevision:z.string(),catalogVersion:z.string()}).strict().optional(),
  decisionToken: z.string(), profileRevision: z.string(), modelFallback: z.boolean(),
}).strict();
export type DecisionChatReply = z.infer<typeof decisionChatReplySchema>;

/** The browser and evaluation harness use the same replay/identity acceptance boundary. */
export function acceptDecisionChatResponse(reply:DecisionChatReply,request:DecisionChatRequest,profileId:string):boolean {
  const binding=reply.binding;
  return Boolean(binding&&binding.requestId===request.requestId&&binding.profileId===profileId&&binding.baseRevision===request.expectedRevision&&binding.profileRevision===reply.profileRevision&&(!request.expectedCatalogVersion||binding.catalogVersion===request.expectedCatalogVersion));
}
