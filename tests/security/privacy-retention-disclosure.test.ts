import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalPages } from "../../src/content/legal";
import { getCurrentAiConsentDisclosure } from "../../src/lib/ai/consent-disclosure";

function readEnvInteger(source: string, name: string) {
  const value = source.match(new RegExp(`^${name}=(\\d+)$`, "mu"))?.[1];
  if (!value) throw new Error(`${name} is missing from the retention fixture`);
  return Number(value);
}

describe("competition response retention disclosure", () => {
  it("describes reversible server caching and removes the page-memory-only claim", () => {
    const privacy = legalPages.privacy.sections.flatMap(({ body }) => body).join("\n");
    const terms = legalPages.terms.sections.flatMap(({ body }) => body).join("\n");
    const consent = getCurrentAiConsentDisclosure();

    for (const disclosure of [privacy, terms, consent.body]) {
      expect(disclosure).toContain("AES-256-GCM");
      expect(disclosure).toContain("30 分钟");
    }
    expect(privacy).toContain("已回答的基础问题");
    expect(privacy).toContain("补充问题与回答");
    expect(privacy).toContain("可逆加密");
    expect(privacy).toContain("服务器备份");
    expect(consent.body).toContain("本标签页会暂存输入");
    expect(consent.body).toContain("关闭标签页或清除暂存后删除");
    expect(consent.body).toContain("暂存不超过会话有效期");
    expect(privacy).not.toContain("这些内容仅保留在当前页面内存中");
    expect(consent.body).not.toContain("系统不会持久化这些问答");
  });

  it("keeps the displayed defaults aligned with production quota and backup policy", async () => {
    const root = process.cwd();
    const [quotas, backups] = await Promise.all([
      readFile(path.join(root, "ops/config/quotas.conf"), "utf8"),
      readFile(path.join(root, "ops/postgresql/backup.env.example"), "utf8")
    ]);
    const privacy = legalPages.privacy.sections.flatMap(({ body }) => body).join("\n");
    const consent = getCurrentAiConsentDisclosure().body;

    expect(readEnvInteger(quotas, "SESSION_TTL_SECONDS")).toBe(30 * 60);
    expect(privacy).toContain("默认最长保留 30 分钟");
    expect(consent).toContain("默认最长 30 分钟");

    const daily = readEnvInteger(backups, "DAILY_RETENTION");
    const weekly = readEnvInteger(backups, "WEEKLY_RETENTION");
    const predeploy = readEnvInteger(backups, "PREDEPLOY_RETENTION");
    expect([daily, weekly, predeploy]).toEqual([14, 8, 5]);
    expect(privacy).toContain(`${daily} 份每日`);
    expect(privacy).toContain(`${weekly} 份每周`);
    expect(privacy).toContain(`最近 ${predeploy} 份发布前备份`);
    expect(consent).toContain(`${daily} 份每日`);
    expect(consent).toContain(`${weekly} 份每周`);
    expect(consent).toContain(`最近 ${predeploy} 份发布前备份`);
  });

  it("requires renewed consent and describes the new model-matching purpose", () => {
    const disclosure = getCurrentAiConsentDisclosure();
    expect(disclosure.version).toBe("2026-11-09.v9");
    const privacy = legalPages.privacy.sections.flatMap(section => section.body).join("");
    expect(privacy).toContain("本人贡献、预算与目标取舍");
    expect(privacy).toContain("逐段经历短文本");
    expect(disclosure.body).toContain("模型决定推荐顺序");
    expect(disclosure.body).toContain("自报能力直接用于匹配，不要求举证");
    expect(disclosure.body).toContain("参赛资格和开赛时间由我自行核查官网");
    expect(legalPages.privacy.updatedAt).toBe("2026-11-09");
    expect(legalPages.terms.updatedAt).toBe("2026-11-09");
  });

  it("discloses the enforced anonymous analytics retention boundary", () => {
    const privacy = legalPages.privacy.sections.flatMap(({ body }) => body).join("\n");

    expect(privacy).toContain("用户标识始终为空");
    expect(privacy).toContain("保留期按 180 天计算");
    expect(privacy).toContain("超过期限的记录在下一次每日清理");
    expect(privacy).toContain("受限的定时任务分批删除");
  });
});
