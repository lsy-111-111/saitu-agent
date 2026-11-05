import {
  aiConsentDisclosureV1Schema,
  type AiConsentDisclosureV1
} from "@/lib/ai/client-consent";

export const AI_EVIDENCE_EXPLANATION_CONSENT_VERSION = "2026-11-05.v7";

const currentAiConsentDisclosure = aiConsentDisclosureV1Schema.parse({
  schemaVersion: "ai-consent-disclosure.v1",
  version: AI_EVIDENCE_EXPLANATION_CONSENT_VERSION,
  heading: "发送前，需要你单独确认这次 AI 使用。",
  body:
    "我已单独同意本站为以下两种用途调用第三方 AI 服务 DeepSeek。理解文字回答或补充问答时，可发送我主动填写的每题最多 120 字文字及理解这些回答所需的学业背景、能力兴趣、目标成果、投入和团队条件。生成推荐解释时，本站先确定竞赛、赛道和顺序，再只把每项的临时编号及根据已确认目标、任务偏好、经历形成的备选依据短句发送给 DeepSeek，请它挑选一至两条供我阅读。解释请求不含问答原文、学校或联系方式、报名日期。参赛资格、竞赛入选及排序均由本站程序决定；解释服务不可用时显示本站已有依据。为避免重复调用并支持原阶段重试，服务端会将含已回答题目、文字确认和补充问答的接口响应以 AES-256-GCM 可逆加密作幂等缓存，默认最长 30 分钟（会话更早到期则随之到期），到期后由定时清理删除。缓存若恰逢备份可能进入仅限管理员恢复的数据库备份，按 14 份每日、8 份每周及最近 5 份发布前备份轮换；发布前备份的实际保留时长取决于发布频率。刷新或离开只会清除页面状态，不会提前清除上述缓存或已有备份。只有我之后主动保存的最多三项推荐快照会写入当前浏览器，站点不建立云端推荐历史。",
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
