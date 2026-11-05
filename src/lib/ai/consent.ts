import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentAiConsentDisclosure } from "@/lib/ai/consent-disclosure";
import { isDatabaseConfigured } from "@/lib/db/pool";
import { getPool } from "@/lib/db/pool";
import { getClientIp } from "@/lib/security/rate-limit";

type ConsentInput = {
  aiConsent?: {
    accepted?: unknown;
    version?: unknown;
  };
};

export type AiConsentPurpose =
  | "competition_normalize"
  | "competition_clarify"
  | "competition_recommend";

export const aiGeneratedNotice = "本内容由 AI（人工智能）生成，仅供参考；请结合赛事官方信息核验。";

/** Record the recipient that actually received competition text, not merely a configured default. */
export function competitionAiConsentAuditTarget(
  ai: {
    provider: string;
    model: string;
    upstreamAttempted: boolean;
  },
  serverModel: string
) {
  return ai.provider === "deepseek" && ai.upstreamAttempted === true
    ? { provider: "deepseek", model: ai.model }
    : { provider: "server", model: serverModel };
}

const ephemeralConsentSalt = randomBytes(32).toString("hex");

export function hasValidAiConsent(body: unknown) {
  const consent = (body as ConsentInput | null)?.aiConsent;
  return consent?.accepted === true && consent.version === getCurrentAiConsentDisclosure().version;
}

export function aiConsentRequiredResponse() {
  const consentDisclosure = getCurrentAiConsentDisclosure();
  return NextResponse.json(
    {
      ok: false,
      error: "AI_CONSENT_REQUIRED",
      consentVersion: consentDisclosure.version,
      consentDisclosure,
      message: "请阅读并单独确认当前版本的 DeepSeek 使用说明，了解文字理解和推荐解释依据选择所需的信息。"
    },
    { status: 403 }
  );
}

function hashIpForConsent(request: Request) {
  const salt = process.env.AI_CONSENT_SALT?.trim() || ephemeralConsentSalt;
  return createHash("sha256").update(`${getClientIp(request)}:${salt}`).digest("hex");
}

async function connectForConsentBefore(
  deadlineEpochMs: number,
  signal?: AbortSignal
) {
  const remainingMs = Math.max(0, deadlineEpochMs - Date.now());
  if (remainingMs <= 0 || signal?.aborted) return null;
  const connection = getPool().connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const settled = await (async () => {
    try {
      return await Promise.race([
        connection.then((client) => ({ client })),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remainingMs);
        }),
        new Promise<null>((resolve) => {
          abort = () => resolve(null);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  })();
  if (!settled) {
    void connection.then((client) => client.release(true)).catch(() => undefined);
    return null;
  }
  return settled.client;
}

async function writeConsentAudit(
  values: [string, string, AiConsentPurpose, string, string],
  deadlineEpochMs: number,
  signal?: AbortSignal
) {
  const client = await connectForConsentBefore(deadlineEpochMs, signal);
  if (!client) return;
  let transactionOpen = false;
  let destroyClient = false;
  const queryBeforeDeadline = async (sql: string, parameters: unknown[] = []) => {
    const remainingMs = Math.max(0, deadlineEpochMs - Date.now());
    if (remainingMs <= 0 || signal?.aborted) throw new Error("consent deadline elapsed");
    const query = client.query(sql, parameters);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const settled = await (async () => {
      try {
        return await Promise.race([
          query.then((result) => ({ result })),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), remainingMs);
          }),
          new Promise<null>((resolve) => {
            abort = () => resolve(null);
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
          })
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
      }
    })();
    if (!settled) {
      destroyClient = true;
      void query.catch(() => undefined);
      throw new Error("consent deadline elapsed");
    }
    return settled.result;
  };
  try {
    if (signal?.aborted || Date.now() >= deadlineEpochMs) return;
    await queryBeforeDeadline("begin");
    transactionOpen = true;
    const remainingMs = Math.max(1, deadlineEpochMs - Date.now());
    await queryBeforeDeadline(
      "select set_config('statement_timeout', $1, true)",
      [`${remainingMs}ms`]
    );
    await queryBeforeDeadline(
      `insert into ai_consents (ip_hash, consent_version, purpose, provider, model)
       values ($1, $2, $3, $4, $5)`,
      values
    );
    await queryBeforeDeadline("commit");
    transactionOpen = false;
  } catch {
    if (transactionOpen && !destroyClient) {
      const rollback = client.query("rollback");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([
          rollback.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 250);
          })
        ]);
        if (!settled) {
          destroyClient = true;
          void rollback.catch(() => undefined);
        }
      } catch {
        destroyClient = true;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  } finally {
    client.release(destroyClient);
  }
}

export async function recordAiConsent(
  request: Request,
  purpose: AiConsentPurpose,
  ai: { provider?: string; model?: string } = {},
  options: { deadlineEpochMs?: number; signal?: AbortSignal } = {}
) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const deadlineEpochMs = Math.min(
    Number.isFinite(options.deadlineEpochMs)
      ? Math.floor(Number(options.deadlineEpochMs))
      : Number.POSITIVE_INFINITY,
    Date.now() + 2_000
  );
  const remainingMs = Math.max(0, deadlineEpochMs - Date.now());
  if (remainingMs <= 0 || options.signal?.aborted) return;

  const write = writeConsentAudit([
    hashIpForConsent(request),
    getCurrentAiConsentDisclosure().version,
    purpose,
    ai.provider?.trim() || process.env.AI_PROVIDER?.trim() || "openai-compatible",
    ai.model?.trim() || process.env.AI_MODEL?.trim() || "mock"
  ], deadlineEpochMs, options.signal).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await Promise.race([
      write,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remainingMs);
      }),
      new Promise<void>((resolve) => {
        abort = resolve;
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) resolve();
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
  }
}
