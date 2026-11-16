import {
  aiConsentDisclosureV1Schema,
  type AiConsentDisclosureV1
} from "@/lib/ai/client-consent";

export const AI_EVIDENCE_EXPLANATION_CONSENT_VERSION = "2026-11-09.v9";

const currentAiConsentDisclosure = aiConsentDisclosureV1Schema.parse({
  schemaVersion: "ai-consent-disclosure.v1",
  version: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION,
  heading: "发送前，需要你单独确认这次 AI 使用。",
  body:
    "我单独同意本站为理解文字回答、比较竞赛及解释匹配原因调用第三方 AI 服务 DeepSeek。可发送我主动提交的经历、学业背景、技能兴趣、目标、本人贡献、时间预算、团队与资源条件，以及公开竞赛任务、届次与来源片段。自报能力直接用于匹配，不要求举证；只有表达歧义时才澄清。模型决定推荐顺序，比赛列表先展示，匹配理由在后台准备并在点击后展示。程序检查引用、版本与输出，必要时使用另一次模型调用检查系统陈述是否有依据，这不是验证我的实际能力。参赛资格和开赛时间由我自行核查官网。请勿填写姓名、学校名称或联系方式。本标签页会暂存输入、会话令牌和推荐以便刷新恢复，关闭标签页或清除暂存后删除；暂存不超过会话有效期。服务端将画像、任务及可恢复响应以 AES-256-GCM 加密暂存，默认最长 30 分钟，会话更早到期则随之到期，由定时清理删除；费用日志不保存问答原文。缓存若恰逢备份可能进入仅限管理员恢复的数据库备份，按 14 份每日、8 份每周及最近 5 份发布前备份轮换，发布前备份的保留时长取决于发布频率。只有我主动收藏的推荐快照才长期保存在当前浏览器，每次最多10项、累计最多50项，不包含完整问答画像，也不建立云端推荐历史。",
  privacyHref: "/privacy"
});

/**
 * Returns the complete disclosure that a user accepts. Production deliberately
 * ignores environment version overrides so a version can never move ahead of
 * the text shown to the user. Existing route tests may select a fixture version.
 */
export function getCurrentAiConsentDisclosure(): AiConsentDisclosureV1 {
  const testVersion = process.env.NODE_ENV === "test"
    ? process.env.AI_CONSENT_VERSION?.trim()
    : undefined;

  return testVersion && testVersion !== currentAiConsentDisclosure.version
    ? { ...currentAiConsentDisclosure, version: testVersion }
    : currentAiConsentDisclosure;
}
