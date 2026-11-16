"use client";

import { useEffect, useRef, useState } from "react";
import type { DecisionChatRequest } from "@/lib/competitions/v6/chat-contracts";
import { recommendationChatReplySchema, type RecommendationChatReplyV7, type RecommendationRunV7 } from "@/lib/competitions/v7/contracts";
import { DecisionClaim, decisionDisplayText } from "./DecisionReport";
import { acceptSubmissionTimingV7, newSubmissionTimingV7, submissionHeadersV7, type SubmissionTimingV7 } from "./submissionTiming";

type Props = { run: RecommendationRunV7; aiConsent: { accepted: true; version: string }; onReply: (reply: RecommendationChatReplyV7) => void };
type Message = { id: string; text: string; reply: RecommendationChatReplyV7; run: RecommendationRunV7 };
const button = "min-h-11 rounded-full border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-40";

export function DecisionRunChat({ run, aiConsent, onReply }: Props) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const retry = useRef<DecisionChatRequest | null>(null);
  const retryTiming = useRef<SubmissionTimingV7 | null>(null);
  const binding = `${run.runId}:${run.profileRevision}:${run.decisionToken}`;
  const activeBinding = useRef(binding);
  activeBinding.current = binding;

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    retry.current = null;
    retryTiming.current = null;
    setBusy(false);
    setError("");
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [binding]);

  async function send(action: DecisionChatRequest["action"], repeat = false) {
    if (busy || run.status === "expired" || run.status === "superseded") return;
    const timing = repeat && retryTiming.current ? retryTiming.current : newSubmissionTimingV7();
    const request: DecisionChatRequest = repeat && retry.current ? retry.current : {
      decisionToken: run.decisionToken, expectedRevision: run.profileRevision,
      expectedProfileId: run.profileId, expectedCatalogVersion: run.catalogVersion,
      requestId: crypto.randomUUID(), aiConsent, action,
    };
    const requestGeneration = generation.current;
    const requestBinding = binding;
    const requestController = new AbortController();
    controller.current = requestController;
    retry.current = request;
    retryTiming.current = timing;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/competition-chat", {
        method: "POST", headers: submissionHeadersV7(timing, { "Content-Type": "application/json" }),
        body: JSON.stringify(request), signal: requestController.signal,
      });
      const payload: unknown = await response.json();
      if (generation.current !== requestGeneration || activeBinding.current !== requestBinding || requestController.signal.aborted) return;
      acceptSubmissionTimingV7(timing, response);
      if (!response.ok) throw new Error(response.status === 409 ? "画像已有更新，请从最新名单继续。" : response.status === 401 ? "本次对话已过期，请修改画像后重新匹配。" : response.status === 403 ? "使用说明已更新，请重新确认后继续。" : "这次对话没有完成，可以重试。");
      const parsed = recommendationChatReplySchema.safeParse(payload);
      if (!parsed.success || parsed.data.requestId !== request.requestId ||
        (parsed.data.run ? parsed.data.run.profileId !== run.profileId || parsed.data.run.profileRevision !== parsed.data.profileRevision || parsed.data.run.decisionToken !== parsed.data.decisionToken : parsed.data.profileRevision !== request.expectedRevision || parsed.data.decisionToken !== request.decisionToken)) {
        throw new Error("这条回复与当前画像不一致，请从最新名单继续。");
      }
      const reply = parsed.data;
      const sentAction = request.action;
      const answeredQuestion = sentAction.type === "answer_question" ? run.report?.usefulQuestions?.find(question => question.id === sentAction.questionId) : undefined;
      const answerLabel = sentAction.type === "answer_question" ? answeredQuestion?.options.find(option => option.value === sentAction.value)?.label : undefined;
      const userText = sentAction.type === "message" ? sentAction.text : sentAction.type === "answer_question" ? `补充了参与条件${answerLabel ? `：${answerLabel}` : ""}` : sentAction.type === "skip_question" && sentAction.disposition === "unknown" ? "这个条件暂不确定" : "先跳过这题";
      setMessages(current => [...current, { id: request.requestId, text: userText, reply, run }].slice(-12));
      setText("");
      retry.current = null;
      retryTiming.current = null;
      onReply(reply);
    } catch (failure) {
      if (generation.current === requestGeneration && activeBinding.current === requestBinding && !requestController.signal.aborted) setError(failure instanceof Error ? failure.message : "暂时无法继续对话。");
    } finally {
      if (generation.current === requestGeneration && activeBinding.current === requestBinding) setBusy(false);
      if (controller.current === requestController) controller.current = null;
    }
  }

  const question = run.report?.usefulQuestions?.[0];
  const expired = run.status === "expired" || run.status === "superseded";
  const priorProfileNote = run.status === "ready" ? "这段对话基于更正前的画像，请以更正后的匹配结果为准。" :
    run.status === "failed" || expired ? "这段对话基于更正前的画像。本次更新未完成，请勿将上次推荐视为更正后的结果。" :
      "这段对话基于更正前的画像。正在按更正后的画像更新，上次推荐仅供回看。";
  const drafts = [
    { label: "为什么没推荐？", text: "为什么没有推荐我想了解的这场比赛？比赛名称：" },
    { label: "不喜欢这些推荐", text: "这些推荐中，我不想继续了解的是：；主要原因是：。请结合这个偏好帮我重新考虑。" },
    { label: "更正或撤回回答", text: "我想更正或撤回之前的回答：" },
  ];
  return <section className="space-y-4 rounded-2xl border border-brand-200 bg-white p-5 md:p-6" aria-labelledby="decision-chat-heading" data-testid="decision-chat-v7">
    <div><h3 id="decision-chat-heading" className="text-lg font-semibold">继续问乐乐</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">追问理由、说明偏好，或更正之前的回答。也可以直接输入你想比较的比赛。</p></div>
    <div aria-live="polite" className="space-y-4">{messages.map(message => <div key={message.id} className="space-y-3 border-t border-border pt-4"><p className="rounded-xl bg-brand-50 p-3 text-sm leading-6"><span className="font-semibold">你：</span>{message.text}</p><div className="space-y-3 text-sm leading-6"><p>{decisionDisplayText(message.reply.message)}</p>{message.run.profileRevision !== run.profileRevision ? <p className="text-xs text-muted-foreground">{priorProfileNote}</p> : null}{message.reply.claims.map((claim, index) => <DecisionClaim key={index} claim={claim} report={message.run.report} showSourceLinks={false} />)}{message.reply.comparison ? <div className="space-y-3 rounded-xl bg-slate-50 p-3">{message.reply.comparison.dimensions.map(dimension => <div key={dimension.label}><p className="font-semibold">{dimension.label}</p>{dimension.values.map(value => <p key={value.itemId}>{message.run.items.find(item => item.itemId === value.itemId)?.name ?? "所选比赛"}：{decisionDisplayText(value.claim.text)}</p>)}</div>)}</div> : null}</div></div>)}</div>
    {question && !expired ? <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold">{question.prompt}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{question.expectedChange}</p><div className="mt-3 flex flex-wrap gap-2">{question.options.map(option => <button key={option.value} className={button} disabled={busy} type="button" onClick={() => void send({ type: "answer_question", questionId: question.id, value: option.value })}>{option.label}</button>)}{(["unknown", "skipped"] as const).map(disposition => <button key={disposition} className={button} disabled={busy} type="button" onClick={() => void send({ type: "skip_question", questionId: question.id, disposition })}>{disposition === "unknown" ? "暂不确定" : "跳过这题"}</button>)}</div></div> : null}
    <form onSubmit={event => { event.preventDefault(); if (text.trim()) void send({ type: "message", text: text.trim() }); }}>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="选择一个话题，编辑后发送">{drafts.map(draft => <button key={draft.label} type="button" className={button} disabled={busy || expired} onClick={() => { setText(draft.text); input.current?.focus(); }}>{draft.label}</button>)}</div>
      <label className="block text-sm font-semibold" htmlFor="decision-chat-input-v7">想追问或更正什么？</label>
      <textarea ref={input} id="decision-chat-input-v7" value={text} onChange={event => setText(event.target.value)} disabled={busy || expired} maxLength={1200} rows={3} placeholder="例如：为什么没推荐数学建模？那段程序其实是队友写的，请撤回我会编程的回答；我的个人预算改为100元。" className="mt-2 w-full rounded-xl border border-control-border p-3 text-sm leading-6" />
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" className={button} disabled={busy || expired || !text.trim()}>{busy ? "正在回复…" : "发送"}</button><span className="text-xs text-muted-foreground">可暂时不回答；不要填写姓名、学号或联系方式。</span></div>
    </form>
    {expired ? <p className="text-sm leading-6">本次对话已结束，请修改画像后重新匹配。</p> : null}
    {error ? <div role="alert" className="space-y-2 text-sm text-error-700"><p>{error}</p>{retry.current ? <button className={button} disabled={busy} type="button" onClick={() => void send(retry.current!.action, true)}>重试这次对话</button> : null}</div> : null}
  </section>;
}
