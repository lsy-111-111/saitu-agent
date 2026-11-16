import {describe,expect,it} from "vitest";
import {claim} from "@/lib/competitions/v6/engine";
import type {MatchPlanV6} from "@/lib/competitions/v6/contracts";
import {buildDecisionContextV7} from "@/lib/competitions/v7/model";
import {buildAssertionReviewPacketV7,type ReviewAssertionV7} from "@/lib/competitions/v7/evidence-packet";
import {directAssertionReviewPacketV7} from "@/lib/competitions/v7/review-transport";
import {createModelIdentifierCodec} from "@/lib/competitions/v6/model-identifiers";
import {student,syntheticRecord} from "../v6/decision-fixtures";

function fixture(presentation="compact_action_reason_v2"){
  const ctx=buildDecisionContextV7(student(),{records:[syntheticRecord(1),syntheticRecord(2)]});
  const plan:MatchPlanV6={profileRevision:ctx.profile.revision,catalogVersion:ctx.catalogVersion,shortfallReason:null,
    recommendations:ctx.candidates.map(({record})=>{
      const reason=claim(`围绕${record.name}的给定任务做一项与个人目标相连的未来练习；设备、资格与材料许可仍待核实。`,"inference",[],[record.facts[0].id],["尚未落实的条件不能写为已经具备。"]);
      return {itemId:record.recordId,reasons:[reason],roleIndex:0,roleReason:structuredClone(reason)};
    })};
  const rows:ReviewAssertionV7[]=plan.recommendations.flatMap(item=>[{key:`${item.itemId}.reason.0`,itemId:item.itemId,reason:item.reasons[0]},
    {key:`${item.itemId}.role`,itemId:item.itemId,reason:item.roleReason!}]);
  const built=buildAssertionReviewPacketV7(ctx,plan,rows);
  const packet={...built,fixedOrder:{...built.fixedOrder,groupReview:{studentPresentation:presentation}}};
  return {ctx,plan,rows,packet};
}

describe("explicit compact joint fit and role review",()=>{
  it("sends one conjunction per identical owner claim, retaining both obligations and complete role/evidence",()=>{
    const {packet,rows}=fixture(),legacy=directAssertionReviewPacketV7({...packet,fixedOrder:{itemIds:packet.fixedOrder.itemIds}});
    const original=structuredClone(packet),transport=directAssertionReviewPacketV7(packet);
    expect(transport.packet.assertions).toHaveLength(2);expect(transport.reviewKeys).toHaveLength(4);
    expect(transport.jointReviewBindings).toEqual([0,1].map(index=>({alias:`R0${index+1}`,keys:rows.slice(index*2,index*2+2).map(row=>row.key),reviewPurposes:["recommendation_fit","selected_role_action"],verdictSemantics:"conjunction_single_provider_verdict"})));
    for(const [index,row] of transport.packet.assertions.entries()){
      expect(row.reviewPurpose).toBe("joint_recommendation_fit_and_role_action");expect(row.reviewPurposes).toEqual(["recommendation_fit","selected_role_action"]);
      expect(row.reason).toEqual(original.assertions[index*2].reason);
      expect(row.editorialRoleIdentity).toEqual(original.assertionEvidence[index*2+1].editorialRoleIdentity);
      expect(row.editorialRoleIdentity?.prerequisite).toBeDefined();
      for(const field of ["allowedItemIds","citedStudentFacts","studentCounterEvidence","studentAnswerUpdates","competitionItems"] as const)
        expect(row[field]).toEqual(legacy.packet.assertions[index*2][field]);
    }
    expect(transport.packet.sharedCandidateBoundaries).toEqual(legacy.packet.sharedCandidateBoundaries);
    expect(transport.packet.jointReviewSemantics).toContain("not_independent_reviews");
    packet.assertions[0].reason.conditions.push("later mutation");packet.assertionEvidence[1].editorialRoleIdentity!.prerequisite="required";
    expect(transport.packet.assertions[0].reason).toEqual(original.assertions[0].reason);
    expect(transport.packet.assertions[0].editorialRoleIdentity).toEqual(original.assertionEvidence[1].editorialRoleIdentity);
  });

  it("expands one false conjunction to both logical failures and binds each to the same provider alias",()=>{
    const {packet,rows}=fixture(),transport=directAssertionReviewPacketV7(packet);
    const response={checks:[{key:"R02",supported:true,reason:"Both obligations supported."},{key:"R01",supported:false,reason:"Selected role prerequisite is not established."}]};
    expect(transport.restoreChecks(response)).toEqual({checks:rows.map((row,index)=>({key:row.key,supported:index>=2,reason:index>=2?"Both obligations supported.":"Selected role prerequisite is not established."}))});
    expect(transport.reviewKeys.slice(0,2).map(row=>row.alias)).toEqual(["R01","R01"]);
    // Public diagnostic metadata cannot mutate the internal restoration map.
    transport.reviewKeys.length=0;transport.jointReviewBindings.length=0;
    expect((transport.restoreChecks(response) as {checks:unknown[]}).checks).toHaveLength(4);
  });

  it.each(["missing","duplicate","foreign","logical-key","wrong-shape"])("rejects %s joint verdict rather than filling in an obligation",kind=>{
    const {packet,rows}=fixture(),transport=directAssertionReviewPacketV7(packet);
    const checks=[{key:"R01",supported:true,reason:"fixture"},{key:"R02",supported:true,reason:"fixture"}];
    if(kind==="missing")checks.pop();if(kind==="duplicate")checks[1].key="R01";if(kind==="foreign")checks[0].key="R03";if(kind==="logical-key")checks[0].key=rows[0].key;
    expect(()=>transport.restoreChecks(kind==="wrong-shape"?{checks:null}:{checks})).toThrow("incomplete_support_review");
  });

  it.each(["text","basis","studentFactIds","competitionFactIds","conditions"] as const)("retains two independent wire rows when %s differs",field=>{
    const {packet}=fixture();
    if(field==="text")packet.assertions[1].reason.text+="角色专属句。";
    if(field==="basis")packet.assertions[1].reason.basis="suggestion";
    if(field==="studentFactIds")packet.assertions[1].reason.studentFactIds.push("different-student-reference");
    if(field==="competitionFactIds")packet.assertions[1].reason.competitionFactIds.push("different-fact-reference");
    if(field==="conditions")packet.assertions[1].reason.conditions.push("角色还有额外前提。");
    const transport=directAssertionReviewPacketV7(packet);expect(transport.packet.assertions).toHaveLength(3);expect(transport.jointReviewBindings).toHaveLength(1);
    expect(transport.reviewKeys[0].alias).not.toBe(transport.reviewKeys[1].alias);
    expect(transport.packet.assertions[1].reason).toEqual(packet.assertions[1].reason);
  });

  it("does not merge different owners or evidence snapshots even when reason text is identical",()=>{
    const {packet}=fixture();packet.assertions[1].itemId=packet.assertions[2].itemId;packet.assertionEvidence[1].itemId=packet.assertions[2].itemId;
    expect(directAssertionReviewPacketV7(packet).packet.assertions).toHaveLength(3);
    const changed=fixture().packet;changed.assertionEvidence[1].studentCounterEvidence.unresolvedFactIds.push("role-only-unresolved");
    const transport=directAssertionReviewPacketV7(changed);expect(transport.packet.assertions).toHaveLength(3);
    expect(transport.packet.assertions[1].studentCounterEvidence.unresolvedFactIds).toContain("role-only-unresolved");
  });

  it.each(["compact_reason_only_v1","compact_action_reason_v2_typo",""])("keeps %s packets on their original one-verdict-per-key interpretation",presentation=>{
    const {packet,rows}=fixture(presentation),transport=directAssertionReviewPacketV7(packet);
    expect(transport.packet.assertions).toHaveLength(4);expect(transport.jointReviewBindings).toEqual([]);
    expect(transport.reviewKeys).toEqual(rows.map((row,index)=>({alias:`R0${index+1}`,key:row.key})));
  });

  it("pairs opaque original keys correctly after identifier aliases change owner IDs",()=>{
    const {packet,rows,ctx}=fixture();
    const codec=createModelIdentifierCodec({candidates:ctx.candidates.map(row=>row.record.recordId),series:ctx.candidates.map(row=>row.record.seriesId),facts:ctx.candidates.flatMap(row=>row.record.facts.map(fact=>fact.id)),students:ctx.profile.facts.map(fact=>fact.id)});
    const transport=directAssertionReviewPacketV7(codec.encode(packet));expect(transport.packet.assertions).toHaveLength(2);
    expect(transport.packet.assertions.every(row=>row.itemId.startsWith("@C"))).toBe(true);
    expect(transport.reviewKeys.map(row=>row.key)).toEqual(rows.map(row=>row.key));
    const restored=codec.decode(transport.restoreChecks({checks:[{key:"R01",supported:true,reason:"both"},{key:"R02",supported:true,reason:"both"}]})) as {checks:{key:string}[]};
    expect(restored.checks.map(row=>row.key)).toEqual(rows.map(row=>row.key));
  });
});
