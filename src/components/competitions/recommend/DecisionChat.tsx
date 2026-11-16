"use client";

import { useEffect, useRef, useState } from "react";
import { acceptDecisionChatResponse, decisionChatReplySchema, type DecisionChatReply, type DecisionChatRequest } from "@/lib/competitions/v6/chat-contracts";
import type { DecisionReportV6 } from "@/lib/competitions/v6/contracts";
import { DecisionClaim, decisionDisplayText } from "./DecisionReport";

type Props = { report: DecisionReportV6; decisionToken: string; aiConsent: {accepted:true;version:string}; onReply: (reply: DecisionChatReply) => void };
type Message = {id:string; userText?:string; reply?:DecisionChatReply; report:DecisionReportV6};
const button="min-h-11 rounded-full border border-brand-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-40";
export function DecisionChat({report,decisionToken,aiConsent,onReply}:Props) {
  const [text,setText]=useState("");
  const [messages,setMessages]=useState<Message[]>([]);
  const [proposal,setProposal]=useState<DecisionChatReply["proposal"]>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const controller=useRef<AbortController|null>(null);
  const retry=useRef<DecisionChatRequest|null>(null);
  const activeToken=useRef(decisionToken); activeToken.current=decisionToken;
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function send(action:DecisionChatRequest["action"],repeat=false) {
    if(busy)return;
    const request:DecisionChatRequest=repeat&&retry.current?retry.current:{decisionToken,expectedRevision:report.profile.revision,expectedProfileId:report.profile.profileId,expectedCatalogVersion:report.catalogVersion,requestId:crypto.randomUUID(),aiConsent,action};
    retry.current=request; setBusy(true); setError("");
    controller.current=new AbortController();
    try {
      const response=await fetch("/api/ai/competition-chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request),signal:controller.current.signal});
      const payload=await response.json();
      if(activeToken.current!==request.decisionToken)return;
      if(!response.ok)throw new Error(response.status===409?"这份报告已有更新，请从最新报告继续，或修改回答后重新匹配。":response.status===401?"本次对话已过期，请重新匹配后继续。":response.status===403?"使用说明已更新，请重新确认后继续。":"这次对话没有完成，可以重试同一请求。");
      const reply=decisionChatReplySchema.parse(payload);
      if(!acceptDecisionChatResponse(reply,request,report.profile.profileId))throw new Error("这条回复与当前请求或画像不一致，请从最新报告继续。");
      setMessages(current=>[...current,{id:request.requestId,userText:request.action.type==="extract_profile"?request.action.utterance:request.action.type==="review_conversation"?"逐轮核对补充信息":request.action.type==="qualify_condition"?request.action.question:request.action.type==="message"?request.action.text:request.action.type==="answer_question"?"回答参与条件问题":request.action.type==="confirm_update"?"确认这次更正":request.action.type==="skip_question"?request.action.disposition==="unknown"?"这个条件暂不确定":"先跳过这题":"取消这次更正",reply,report}].slice(-12));
      setProposal(reply.proposal); setText(""); retry.current=null; onReply(reply);
    } catch (failure) {
      if(!controller.current?.signal.aborted)setError(failure instanceof Error?failure.message:"暂时无法继续对话。");
    } finally {setBusy(false);}
  }
  return <section className="space-y-4 rounded-2xl border border-brand-200 bg-white p-5 md:p-6" aria-labelledby="decision-chat-heading" data-testid="decision-chat">
    <div><h3 id="decision-chat-heading" className="text-lg font-semibold">继续聊，帮你做下一步选择</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">可以追问为什么适合、比较两项，或更正经历和条件。也可用“核实……”核对一条赛事规则。涉及画像的更正，会先请你确认，再重新匹配。</p></div>
    <div aria-live="polite" className="space-y-4">{messages.map(message=><div key={message.id} className="space-y-3 border-t border-border pt-4">
      {message.userText?<p className="rounded-xl bg-brand-50 p-3 text-sm leading-6"><span className="font-semibold">你：</span>{message.userText}</p>:null}
      {message.reply?<div className="space-y-3 text-sm leading-6"><p>{decisionDisplayText(message.reply.message)}</p>{message.reply.modelFallback?<p className="text-xs text-muted-foreground">本次模型回复未通过或未能完成，未核实的地方仍保持未知，当前画像不会自动改变。</p>:null}
        {message.report.profile.revision!==report.profile.revision?<p className="text-xs text-muted-foreground">以下是更正前报告的对照，当前判断请看上方最新报告。</p>:null}
        {message.reply.claims.map((value,index)=><DecisionClaim key={index} claim={value} report={message.report}/>)}
        {message.reply.sourceJudgments?.map(judgment=><div key={judgment.id} className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">{({supported:"来源支持",contradicted:"来源有明确相反依据",unknown:"暂无法核实"})[judgment.status]}</p><p>{judgment.reason}</p>{judgment.evidence.map((e,index)=><blockquote key={index} className="mt-2 border-l-2 border-brand-200 pl-3"><p>{e.quote}</p><a href={e.url} target="_blank" rel="noreferrer" className="underline">来源原文</a><p className="text-xs text-muted-foreground">适用范围：{e.scope}</p></blockquote>)}</div>)}
        {message.reply.conditionJudgment?<div className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">{({satisfied:"满足这一项条件",violated:"不满足这一项条件",unknown:"这一项条件仍待核实"})[message.reply.conditionJudgment.decision]}</p><p>{message.reply.conditionJudgment.reason}</p>{message.reply.conditionJudgment.evidence.map((e,index)=><blockquote key={index} className="mt-2 border-l-2 border-brand-200 pl-3"><p>{e.quote}</p><a href={e.url} target="_blank" rel="noreferrer" className="underline">来源原文</a></blockquote>)}</div>:null}
        {message.reply.comparison?<div className="space-y-2 rounded-xl bg-slate-50 p-3">{message.reply.comparison.dimensions.map(dimension=><div key={dimension.label}><p className="font-semibold">{dimension.label}</p>{dimension.values.map(value=><p key={value.itemId}>{message.report.recommendations.find(item=>item.itemId===value.itemId)?.name}：{decisionDisplayText(value.claim.text)}</p>)}</div>)}</div>:null}
      </div>:null}
    </div>)}</div>
    {proposal?<div className="rounded-xl border border-brand-300 bg-brand-50 p-4" data-testid="decision-update-proposal"><h4 className="font-semibold">确认这次更正</h4><p className="mt-2 text-sm leading-6">你的原话：{proposal.originalText}</p><p className="mt-2 text-sm leading-6">我理解为：{proposal.summary}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={()=>void send({type:"confirm_update",proposalId:proposal.id})}>确认更正并重新匹配</button><button type="button" className={button} disabled={busy} onClick={()=>void send({type:"reject_update",proposalId:proposal.id})}>取消更正</button></div></div>:null}
    {!proposal&&report.usefulQuestions?.[0]?<div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold">{report.usefulQuestions[0].prompt}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{report.usefulQuestions[0].expectedChange}</p><div className="mt-3 flex flex-wrap gap-2">{report.usefulQuestions[0].options.map(option=><button key={option.value} className={button} disabled={busy} onClick={()=>void send({type:"answer_question",questionId:report.usefulQuestions![0].id,value:option.value})}>{option.label}</button>)}{(["unknown","skipped"] as const).map(disposition=><button key={disposition} className={button} disabled={busy} onClick={()=>void send({type:"skip_question",questionId:report.usefulQuestions![0].id,disposition})}>{disposition==="unknown"?"暂不确定":"跳过这题"}</button>)}</div></div>:null}
    <form onSubmit={event=>{event.preventDefault();if(text.trim())void send({type:"message",text:text.trim()});}}>
      <label className="block text-sm font-semibold" htmlFor="decision-chat-input">想追问或更正什么？</label>
      <textarea id="decision-chat-input" value={text} onChange={event=>setText(event.target.value)} disabled={busy} maxLength={1200} rows={3} placeholder="例如：这两项主要区别是什么？其实那段程序是队友写的；我的预算改为100元。" className="mt-2 w-full rounded-xl border border-control-border p-3 text-sm leading-6"/>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button type="submit" className={button} disabled={busy||!text.trim()}>{busy?"正在核对依据…":"发送"}</button><span className="text-xs text-muted-foreground">可暂时不回答；不要填写姓名、学号或联系方式。</span></div>
    </form>
    {error?<div role="alert" className="space-y-2 text-sm text-error-700"><p>{error}</p>{retry.current?<button className={button} disabled={busy} type="button" onClick={()=>void send(retry.current!.action,true)}>重试这次对话</button>:null}</div>:null}
  </section>;
}
