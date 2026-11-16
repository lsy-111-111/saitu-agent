import { describe, expect, it } from "vitest";
import { aggregateProfileAtoms } from "../../../scripts/competitions/v6/profile-atom-metrics";
import { scoringHash } from "../../../scripts/competitions/v6/score-product-observations";
type Input = Parameters<typeof aggregateProfileAtoms>[0];
function fixture():Input {
  const cases=[],keys=[],observations=[],reviews=[],expectedByCase=new Map<string,unknown>();
  for (let i=0;i<120;i++) {
    const caseId=String(i), input={utterance:"我只负责整理问卷"};
    const item={caseId, operation:"extract_profile", templateFamilyId:i?"standard":"limited_contribution",input};
    const expected={facts:[{field:"contribution",value:"协助"}],unknownFields:["teamSize"]};
    expectedByCase.set(caseId,expected);
    const key={caseId,authorContextId:"author",annotationStatus:"adjudicated" as const,scoring:{expected}};
    const output={facts:[{field:"contribution",value:"辅助整理",confirmed:false,sourceText:"只负责整理问卷"}],unknownFields:i?["teamSize"]:["budget"]};
    const obs={caseId,operation:item.operation,repetition:0,inputSha256:scoringHash(input),status:"observed" as const,output,events:[]};
    const pairs=(i?[0,1]:[0]).map(n=>({expected:n,observed:n,reason:"独立核对陈述和未知字段"}));
    for(const role of ["reviewer_a","reviewer_b"] as const) reviews.push({caseId,role,contextId:role,repetition:0,keySha256:scoringHash(key),observationSha256:scoringHash(obs),decisions:[],profileAlignment:{complete:true,pairs,goldSha256:scoringHash(expected)}});
    cases.push(item);keys.push(key);observations.push(obs);
  }
  return {cases,keys,observations,reviews,expectedByCase};
}
describe("profile micro and slice F1 from independent atom alignments",()=>{
  it("counts an added and missed unknown separately and accepts a reviewed equivalent expression",()=>{
    const out=aggregateProfileAtoms(fixture());
    expect(out).toMatchObject({complete:true,total:{tp:239,fp:1,fn:1,cases:120},minimumSliceF1:0.5});
    expect(out.microF1).toBeCloseTo(239/240);
  });
  it("keeps a disagreement unresolved until a separate adjudicator binds both original reviews",()=>{
    const f=fixture(), [a,b]=f.reviews; b.profileAlignment={...b.profileAlignment!,complete:true,pairs:[]};
    expect(aggregateProfileAtoms(f)).toMatchObject({complete:false,pending:["0"],microF1:null});
    f.reviews.push({...a,role:"adjudicator",contextId:"third",resolvesReviewSha256:[scoringHash(a),scoringHash(b)]});
    expect(aggregateProfileAtoms(f).complete).toBe(true);
    b.profileAlignment!.pairs.push({expected:0,observed:1,reason:"invalid reuse of different atom type"});
    expect(()=>aggregateProfileAtoms(f)).toThrow("invalid_or_reused_atom_alignment");
  });
  it("counts a failed extraction as missed, but an unexecuted one cannot produce an aggregate",()=>{
    const f=fixture();f.observations[0].status="error";
    expect(aggregateProfileAtoms(f).total).toMatchObject({cases:120,tp:238,fn:2,fp:0});
    f.observations[0].status="not_run";expect(aggregateProfileAtoms(f).microF1).toBeNull();
  });
});
