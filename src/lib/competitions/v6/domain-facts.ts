import { z } from "zod";

/** Flat paths preserve member/work/domain facts without projecting them into unrelated V5 fields. */
export const domainFieldSchema=z.string().min(1).max(160).regex(/^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u).refine(field=>!field.split(/[.:]/).some(part=>["__proto__","prototype","constructor"].includes(part))&&!['profileId','revision','schemaVersion','confirmed','system','role'].includes(field));
export const domainFactSchema=z.object({field:domainFieldSchema,value:z.union([z.string().max(1600),z.number().finite(),z.boolean()]),state:z.enum(["affirmed","negated","unknown","conditional","retracted"]),evidenceLevel:z.enum(["self_report","concrete_experience","unknown"]),confirmed:z.boolean(),sourceText:z.string().min(1).max(1600)}).strict();
export type DomainFact=z.infer<typeof domainFactSchema>;
export const extractionSchema=z.object({facts:z.array(domainFactSchema).max(160),unknownFields:z.array(domainFieldSchema).max(160)}).strict();
export type ProfileExtraction=z.infer<typeof extractionSchema>;
export type AssertionSnapshot=ProfileExtraction & {changedFields:string[]};

function sentenceAround(text:string,quote:string){
  const at=text.indexOf(quote);const start=Math.max(text.lastIndexOf("。",at),text.lastIndexOf("\n",at),text.lastIndexOf("；",at))+1;
  const end=text.slice(at+quote.length).search(/[。\n；]/);
  return text.slice(start,end<0?text.length:at+quote.length+end);
}
/** This validation is shared by chat updates and standalone extraction. It cannot manufacture confirmation. */
export function validateProfileExtraction(utterance:string,raw:unknown,options:{requestedFields?:readonly string[];confirmedSelection?:boolean}={}):ProfileExtraction {
  const parsed=extractionSchema.parse(raw), requested=options.requestedFields?new Set(options.requestedFields):null;
  const facts=parsed.facts.map(fact=>{
    if(!utterance.includes(fact.sourceText))throw new Error("extraction_quote_not_in_utterance");
    if(requested&&!requested.has(fact.field))throw new Error("extraction_field_not_requested");
    const sentence=sentenceAround(utterance,fact.sourceText);
    const otherPerson=/队友说|朋友说|同学说|老师说|他说|她说|别人说|my friend said|teammate said/i.test(sentence);
    if(otherPerson&&!/^(?:team\.|members?\.|other\.|quoted\.)/.test(fact.field))throw new Error("quoted_other_person_is_not_self_evidence");
    const conditional=/(?:如果|假如|假设|将来|计划|打算|希望以后|有朝一日|would|suppose|if I|plan to)/i.test(sentence);
    if(/skill|ability|can[A-Z]|能力/.test(fact.field)&&/(?:喜欢|感兴趣|想学|希望学|interested in|want to learn)/i.test(sentence)&&!/(?:做过|完成过|独立完成|能够|已经会|can already|have built)/i.test(sentence)&&fact.state==="affirmed")throw new Error("interest_cannot_become_ability");
    const state=conditional&&fact.state==="affirmed"?"conditional":fact.state;
    return {...fact,state,confirmed:Boolean(options.confirmedSelection&&!["unknown","conditional","retracted"].includes(state))};
  });
  const known=new Set(facts.filter(f=>!["unknown","conditional","retracted"].includes(f.state)).map(f=>f.field));
  const unknownFields=[...new Set([...(options.requestedFields??parsed.unknownFields),...facts.filter(f=>f.state==="unknown"||f.state==="conditional").map(f=>f.field)])].filter(field=>!known.has(field));
  return {facts,unknownFields};
}
const semantic=(facts:DomainFact[])=>JSON.stringify(facts.map(({field,value,state,evidenceLevel,confirmed})=>({field,value,state,evidenceLevel,confirmed})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
/** Updates replace only asserted fields; future conditions never erase an already confirmed present fact. */
export function mergeAssertionSnapshot(current:ProfileExtraction,incoming:ProfileExtraction):AssertionSnapshot {
  let facts=[...current.facts];const changedFields:string[]=[];
  for(const field of new Set(incoming.facts.map(f=>f.field))){
    const before=facts.filter(f=>f.field===field), group=incoming.facts.filter(f=>f.field===field);
    const onlyConditional=group.every(f=>f.state==="conditional");
    const after=onlyConditional?[...before.filter(f=>f.state!=="conditional"),...group]:group.filter(f=>f.state!=="retracted");
    if(semantic(before)!==semantic(after)){changedFields.push(field);facts=[...facts.filter(f=>f.field!==field),...after];}
  }
  const known=new Set(facts.filter(f=>!["unknown","conditional","retracted"].includes(f.state)).map(f=>f.field));
  const unknownFields=[...new Set([...current.unknownFields,...incoming.unknownFields,...incoming.facts.filter(f=>f.state==="retracted").map(f=>f.field)])].filter(field=>!known.has(field));
  return {facts,unknownFields,changedFields};
}
