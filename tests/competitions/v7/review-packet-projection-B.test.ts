import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claim } from "@/lib/competitions/v6/engine";
import type { MatchPlanV6 } from "@/lib/competitions/v6/contracts";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";
import { buildAssertionReviewPacketV7 } from "@/lib/competitions/v7/evidence-packet";
import { buildDecisionContextV7 } from "@/lib/competitions/v7/model";
import { directAssertionReviewPacketV7 } from "@/lib/competitions/v7/review-transport";
import { expandReviewPacketV7, projectReviewPacketV7, REVIEW_PACKET_PROJECTION_PROMPT_V7, REVIEW_PACKET_PROJECTION_VERSION_V7 } from "@/lib/competitions/v7/review-packet-projection";
import { student, syntheticRecord } from "../v6/decision-fixtures";

function fixture() {
  const context = buildDecisionContextV7(student({ skills: ["data-analysis"], confirmedFields: ["stage", "skills"] }), { records: Array.from({ length: 5 }, (_, index) => syntheticRecord(index + 1)) });
  const studentFact = context.profile.facts[0];
  context.profile.facts.push({ ...structuredClone(studentFact), id: "student-negative-boundary", state: "negated", confirmed: false, originalText: "团队里由同伴完成模型，本人没有独立完成。", value: false });
  context.profile.retractedFactIds.push("superseded-student-row");
  const plan: MatchPlanV6 = { profileRevision: context.profile.revision, catalogVersion: context.catalogVersion, shortfallReason: null,
    recommendations: context.candidates.map(({ record }) => {
      const reason = claim(`可围绕${record.name}的原任务练习数据整理，并记录本人处理决策；资源、材料许可及当前资格仍需核实，不能把尚未落实的条件当作已有，也不承诺取得赛事个人反馈。`, "inference", [studentFact.id], [record.facts[0].id], ["仅在有权使用数据并完成本人工作后展示。"]);
      return { itemId: record.recordId, reasons: [reason], roleIndex: 0, roleReason: structuredClone(reason) };
    }) };
  const assertions = plan.recommendations.flatMap(item => [{ key: `${item.itemId}.reason.0`, itemId: item.itemId, reason: item.reasons[0] }, { key: `${item.itemId}.role`, itemId: item.itemId, reason: item.roleReason! }]);
  const raw = buildAssertionReviewPacketV7(context, plan, assertions);
  const packet = { ...raw, fixedOrder: { ...raw.fixedOrder, groupReview: { studentPresentation: "compact_action_reason_v2", preparedSha256: "a".repeat(64) } } };
  const codec = createModelIdentifierCodec({ candidates: context.candidates.map(row => row.record.recordId), series: context.candidates.map(row => row.record.seriesId), facts: context.candidates.flatMap(row => row.record.facts.map(fact => fact.id)), students: context.profile.facts.map(fact => fact.id) });
  const transport = directAssertionReviewPacketV7(codec.encode(packet));
  return { context, plan, packet, transport, wire: transport.packet, codec };
}
type Wire = ReturnType<typeof fixture>["wire"];
type JsonRow = Record<string, unknown>;
const boundaryUse = "conditions_and_counterevidence_only_not_positive_support";
const row = (value: unknown) => value as JsonRow;
const rows = (value: unknown) => value as JsonRow[];
function defaultFixture() {
  const value = fixture();
  for (const entry of value.wire.sharedCandidateBoundaries) {
    const b = row(entry.boundary), text = "材料许可、当前资格和设备尚未核实，不能推断学生已具备，也不能承诺个人反馈。";
    rows(b.qualifiers).push({ path: "limits.materialAccess", value: { text, kind: "unknown", factIds: [], conditions: ["仅作待核条件，不能作为正面支持。"], unknownReason: text }, use: boundaryUse });
    rows(b.editorialSectionBoundaries).push({ path: "sections.task", kind: "editorial_inference", factIds: [], conditions: ["须保留原任务范围。"], factIdsArePremisesOnly: true, use: boundaryUse });
    b.sourceBoundary = { sourceBoundary: "published_work", origin: "participant", originMeaning: "作品作者自述", sourceIds: [], scope: "仅该作品", use: boundaryUse };
  }
  return value;
}
const project = (wire: Wire) => { const result = projectReviewPacketV7(wire); expect(result.projected).toBe(true); return result.packet as Wire; };
const isRef = (value: unknown) => value !== null && typeof value === "object" && Object.hasOwn(value, "$reviewRef");
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline_review_projection_forbids_http"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("B exact same-owner review sharing", () => {
  it("roundtrips every original field and byte order while keeping full profile and each reason inline", () => {
    const { wire } = fixture(), snapshot = JSON.stringify(wire), result = projectReviewPacketV7(wire), projected = result.packet as Wire;
    expect(result.projected).toBe(true); expect(result.projectedBytes + Buffer.byteLength(REVIEW_PACKET_PROJECTION_PROMPT_V7)).toBeLessThan(result.originalBytes);
    expect(JSON.stringify(expandReviewPacketV7(projected))).toBe(snapshot);
    expect(JSON.stringify(wire)).toBe(snapshot); expect(projected.profile).toEqual(wire.profile);
    expect(projected.assertions.map(row => row.reason)).toEqual(wire.assertions.map(row => row.reason));
    expect(projected.assertions.every(row => !isRef(row.reason))).toBe(true);
    expect(projected.assertions.map(row => [row.key, row.itemId, row.reviewPurpose, row.reviewPurposes, row.allowedItemIds])).toEqual(wire.assertions.map(row => [row.key, row.itemId, row.reviewPurpose, row.reviewPurposes, row.allowedItemIds]));
    expect(projected.fixedOrder).toEqual(wire.fixedOrder);
    expect(projected.assertions.every(row => isRef(row.citedStudentFacts[0]))).toBe(true);
    expect(projected.sharedCandidateBoundaries.every(row => isRef(row.boundary.displayedRecommendation.nextStep))).toBe(true);
  });

  it("preserves negated, conditional, unknown, retracted, contribution and update data without selecting a new profile", () => {
    const { wire } = fixture();
    const extraProfile = { original: "仅处理数据；模型由队友建立。", conditional: ["设备未落实"], unknown: true, updates: [{ supersedes: ["old"], sourceSpan: { start: 0, end: 12 } }], $reviewRef: "literal unknown data, not an instruction" };
    Object.assign(wire.profile, { futureProvenance: extraProfile });
    const result = project(wire), restored = expandReviewPacketV7(result) as Wire;
    expect(result.profile).toEqual(wire.profile); expect(restored.profile).toEqual(wire.profile);
    expect(restored.assertions.map(row => row.studentCounterEvidence)).toEqual(wire.assertions.map(row => row.studentCounterEvidence));
    expect(restored.profile.retractedFactIds).toContain("superseded-student-row");
    expect(restored.profile.facts.find(fact => fact.state === "negated")?.originalText).toContain("同伴");
    expect(Reflect.get(restored.profile, "futureProvenance")).toEqual(extraProfile);
  });

  it("retains newly supplied complete task/selected-role boundaries, source provenance and unknown extensions byte for byte", () => {
    const { wire } = fixture();
    const addition = { selectedRoleOriginal: { roleIndex: 0, task: "量测并记录误差；由本人解释限制。", personalDeliverable: "原始记录与校验说明", prerequisite: "required", use: "editorial_not_positive_support" },
      taskFacts: [{ id: "unresolved-original-id", text: "官方任务原文，不是可选方法。", sourceIds: ["task-source"], status: "conflicting", conflictsWith: ["corrected-task"], supersedes: ["old-task"] }],
      taskSourceBindings: { sources: [{ id: "task-source", scope: "固定届次", sourceExcerpt: "完整来源原文", verificationMethod: "original_method" }], unresolvedSourceIds: ["missing-source"], ambiguousSourceIds: ["ambiguous-source"] } };
    Object.assign(wire.sharedCandidateBoundaries[0].boundary, addition);
    expect(Reflect.get(project(wire).sharedCandidateBoundaries[0].boundary, "selectedRoleOriginal")).toEqual(addition.selectedRoleOriginal);
    expect(JSON.stringify(expandReviewPacketV7(project(wire)))).toBe(JSON.stringify(wire));
  });

  it("does not pool identical foreign-owner competition facts or sources into another assertion", () => {
    const { wire } = fixture(), first = wire.assertions[0].competitionItems[0], foreign = wire.assertions[1].competitionItems[0];
    foreign.citedFacts = structuredClone(first.citedFacts); foreign.sources = structuredClone(first.sources);
    const result = project(wire);
    expect(result.assertions[1].competitionItems[0].citedFacts).toEqual(foreign.citedFacts);
    expect(result.assertions[1].competitionItems[0].sources).toEqual(foreign.sources);
    expect(result.assertions[1].allowedItemIds).toEqual(wire.assertions[1].allowedItemIds);
    expect(JSON.stringify(expandReviewPacketV7(result))).toBe(JSON.stringify(wire));
  });

  it("leaves unmatched extended student facts inline instead of making another assertion a profile anchor", () => {
    const { wire } = fixture();
    for (const row of wire.assertions) Object.assign(row.citedStudentFacts[0], { unknownExtension: "not in full original profile" });
    const result = project(wire);
    expect(result.assertions.every(row => !isRef(row.citedStudentFacts[0]))).toBe(true);
    expect(JSON.stringify(expandReviewPacketV7(result))).toBe(JSON.stringify(wire));
    const tampered = structuredClone(result);
    tampered.assertions[1].citedStudentFacts[0] = { $reviewRef: "/assertions/0/citedStudentFacts/0" } as unknown as typeof tampered.assertions[1]["citedStudentFacts"][0];
    expect(() => expandReviewPacketV7(tampered)).toThrow("invalid_review_projection_packet");
  });

  it("rejects references to an earlier reference even after that earlier cell was expanded", () => {
    const value = project(fixture().wire);
    expect(isRef(value.assertions[0].citedStudentFacts[0])).toBe(true);
    value.assertions[1].citedStudentFacts[0] = { $reviewRef: "/assertions/0/citedStudentFacts/0" } as unknown as typeof value.assertions[1]["citedStudentFacts"][0];
    expect(() => expandReviewPacketV7(value)).toThrow("invalid_review_projection_packet");
  });

  it.each(["text", "status", "scope", "sourceIds", "conflictsWith", "supersedes"] as const)("does not merge same-ID facts with changed %s", field => {
    const { wire } = fixture(), item = wire.assertions[0].competitionItems[0], changed = structuredClone(item.citedFacts[0]);
    if (field === "sourceIds" || field === "conflictsWith" || field === "supersedes") changed[field].push("different-boundary");
    else if (field === "status") changed.status = "conflicting";
    else changed[field] += "changed";
    item.contradictionContext.facts.push(changed);
    const result = project(wire);
    expect(result.assertions[0].competitionItems[0].contradictionContext.facts.at(-1)).toEqual(changed);
    expect(JSON.stringify(expandReviewPacketV7(result))).toBe(JSON.stringify(wire));
  });

  it("shares exact same-owner facts/sources without moving them between cited and counterevidence positions", () => {
    const { wire } = fixture(), item = wire.assertions[0].competitionItems[0];
    item.contradictionContext.facts.push(structuredClone(item.citedFacts[0]));
    item.contradictionContext.sourceBindings.sources.push(structuredClone(item.sources[0]));
    const result = project(wire), own = result.assertions[0].competitionItems[0];
    expect(isRef(own.contradictionContext.facts.at(-1))).toBe(true); expect(isRef(own.contradictionContext.sourceBindings.sources.at(-1))).toBe(true);
    expect(own.citedFacts).toEqual(item.citedFacts); expect(result.assertions[0].reason.competitionFactIds).toEqual(wire.assertions[0].reason.competitionFactIds);
    expect(JSON.stringify(expandReviewPacketV7(result))).toBe(JSON.stringify(wire));
  });

  it("recognizes the added original-task closure only as a same-owner boundary and leaves the full selected role inline", () => {
    const { wire } = fixture(), item = wire.assertions[0].competitionItems[0], boundary = wire.sharedCandidateBoundaries[0].boundary;
    const task = { facts: structuredClone(item.citedFacts), unresolvedFactIds: ["missing-original-task"],
      sourceBindings: { sources: structuredClone(item.sources), unresolvedSourceIds: ["missing-task-source"], ambiguousSourceIds: ["ambiguous-task-source"] },
      use: "task_identity_and_counterevidence_only_not_positive_support" };
    const selectedRole = { roleIndex: 0, task: "按原任务整理测量记录。", personalDeliverable: "本人记录与误差说明", prerequisite: "required", kind: "editorial_inference", use: "editorial_role_identity_and_action_boundary_not_official_or_student_positive_evidence" };
    Object.assign(boundary, { originalTaskContext: task, selectedRoleOriginal: selectedRole });
    const result = project(wire), selected = result.sharedCandidateBoundaries[0].boundary;
    const transported = Reflect.get(selected, "originalTaskContext") as typeof task;
    expect(isRef(transported.facts[0])).toBe(true); expect(isRef(transported.sourceBindings.sources[0])).toBe(true);
    expect(transported.unresolvedFactIds).toEqual(task.unresolvedFactIds); expect(transported.sourceBindings.unresolvedSourceIds).toEqual(task.sourceBindings.unresolvedSourceIds);
    expect(transported.use).toBe(task.use); expect(Reflect.get(selected, "selectedRoleOriginal")).toEqual(selectedRole);
    expect(result.assertions[0].reason.competitionFactIds).toEqual(wire.assertions[0].reason.competitionFactIds);
    expect(JSON.stringify(expandReviewPacketV7(result))).toBe(JSON.stringify(wire));
  });

  it("keeps the existing joint verdict map and original false verdict for both obligations", () => {
    const { wire, transport, codec, packet } = fixture(), keys = structuredClone(transport.reviewKeys), joints = structuredClone(transport.jointReviewBindings);
    project(wire);
    const response = { checks: wire.assertions.map(row => ({ key: row.key, supported: row.key !== "R03", reason: row.key === "R03" ? "原具体任务与个人练习之间缺少桥接。" : "fixture judgment" })) };
    const restored = codec.decode(transport.restoreChecks(response)) as { checks: { key: string; supported: boolean }[] };
    expect(restored.checks.filter(row => !row.supported).map(row => row.key)).toEqual(packet.assertions.slice(4, 6).map(row => row.key));
    expect(transport.reviewKeys).toEqual(keys); expect(transport.jointReviewBindings).toEqual(joints);
    expect(() => transport.restoreChecks({ checks: response.checks.slice(1) })).toThrow("incomplete_support_review");
  });

  it.each(["missing", "forward", "self", "cross-owner", "wrong-kind", "partial", "reason-anchor"])("rejects %s pointer tampering", kind => {
    const value = project(fixture().wire);
    const row = value.assertions[0], item = row.competitionItems[0];
    const pointer = kind === "missing" ? "/not-present" : kind === "forward" ? "/assertions/4/citedStudentFacts/0" : kind === "self" ? "/assertions/0/citedStudentFacts/0" : kind === "cross-owner" ? "/assertions/0/competitionItems/0/citedFacts/0" : kind === "wrong-kind" ? "/profile/facts/0" : "/profile/facts/0";
    if (kind === "cross-owner") value.assertions[1].competitionItems[0].citedFacts[0] = { $reviewRef: pointer } as unknown as typeof item.citedFacts[0];
    else if (kind === "wrong-kind") item.sources[0] = { $reviewRef: pointer } as unknown as typeof item.sources[0];
    else if (kind === "reason-anchor") row.reason = { $reviewRef: pointer } as unknown as typeof row.reason;
    else row.citedStudentFacts[0] = { $reviewRef: pointer, ...(kind === "partial" ? { text: "extra body" } : {}) } as unknown as typeof row.citedStudentFacts[0];
    expect(() => expandReviewPacketV7(value)).toThrow("invalid_review_projection_packet");
  });

  it("preserves literal reference-looking text and unknown objects rather than interpreting arbitrary trees", () => {
    const { wire } = fixture(); wire.assertions[0].reason.text += " {$reviewRef:'/profile/facts/0'}";
    Object.assign(wire, { unrecognized: { $reviewRef: "/never-execute" } });
    const result = expandReviewPacketV7(project(wire)); expect(JSON.stringify(result)).toBe(JSON.stringify(wire));
  });

  it("clones plain packets unchanged and rejects double projection or unsupported versions", () => {
    const { wire } = fixture(); expect(expandReviewPacketV7(wire)).toEqual(wire); expect(expandReviewPacketV7(wire)).not.toBe(wire);
    const value = project(wire); expect(() => projectReviewPacketV7(value)).toThrow("invalid_review_projection_packet");
    expect(() => expandReviewPacketV7({ ...value, reviewProjection: "saitu.review-exact-projection.v999" })).toThrow("invalid_review_projection_packet");
    expect(Reflect.get(value, "reviewProjection")).toBe(REVIEW_PACKET_PROJECTION_VERSION_V7);
  });

  it("keeps original scope validation fail-closed for foreign and nonexistent fact references", () => {
    const { context, plan } = fixture(), item = plan.recommendations[0];
    for (const id of [context.candidates[1].record.facts[0].id, "unknown-reference", context.candidates[0].record.sources[0].id]) {
      const reason = { ...item.reasons[0], competitionFactIds: [id] }, changed = { ...plan, recommendations: [{ ...item, reasons: [reason] }, ...plan.recommendations.slice(1)] };
      expect(() => buildAssertionReviewPacketV7(context, changed, [{ itemId: item.itemId, key: `${item.itemId}.reason.0`, reason }])).toThrow("invalid_review_competition_fact_scope");
    }
  });

  it("does not enlarge a tiny original packet for a transport marker or system instruction", () => {
    const tiny = { profile: { facts: [] }, assertions: [], sharedCandidateBoundaries: [] };
    const result = projectReviewPacketV7(tiny); expect(result).toEqual({ packet: tiny, projected: false, originalBytes: Buffer.byteLength(JSON.stringify(tiny)), projectedBytes: Buffer.byteLength(JSON.stringify(tiny)) });
  });
});

describe("B v2 typed local review-boundary defaults", () => {
  it("restores every original byte after omitting only same-owner child use and same-object unknownReason", () => {
    const { wire } = defaultFixture(), before = JSON.stringify(wire), value = project(wire);
    expect(Reflect.get(value, "reviewProjection")).toBe(REVIEW_PACKET_PROJECTION_VERSION_V7);
    expect(Reflect.get(value, "reviewBoundaryDefaults")).toEqual({ use: "same_owner_boundary", unknownReason: "same_object_text" });
    const b = row(value.sharedCandidateBoundaries[0].boundary), q = rows(b.qualifiers).at(-1)!;
    expect(b.use).toBe(boundaryUse);
    expect(q).not.toHaveProperty("use"); expect(row(q.value)).not.toHaveProperty("unknownReason");
    expect(rows(b.editorialSectionBoundaries).at(-1)).not.toHaveProperty("use");
    expect(rows(b.editorialRoleBoundaries)[0]).not.toHaveProperty("use");
    expect(b.sourceBoundary).not.toHaveProperty("use");
    expect(value.profile).toEqual(wire.profile);
    expect(value.assertions.map(assertion => assertion.reason)).toEqual(wire.assertions.map(assertion => assertion.reason));
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(before);
    expect(JSON.stringify(wire)).toBe(before);
  });

  it("leaves different child purposes and different unknown explanations explicit", () => {
    const { wire } = defaultFixture(), b = row(wire.sharedCandidateBoundaries[0].boundary), q = rows(b.qualifiers).at(-1)!;
    q.use = "additional_independent_limit_only";
    row(q.value).unknownReason = "当前年份未核验；此原因不同于材料许可正文。";
    row(b.sourceBoundary).use = "published_work_only_not_official_rules";
    const value = project(wire), projected = row(value.sharedCandidateBoundaries[0].boundary), projectedQualifier = rows(projected.qualifiers).at(-1)!;
    expect(projectedQualifier.use).toBe(q.use); expect(row(projectedQualifier.value).unknownReason).toBe(row(q.value).unknownReason);
    expect(row(projected.sourceBoundary).use).toBe(row(b.sourceBoundary).use);
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it.each(["qualifier", "claim", "section", "role", "source"])("keeps unknown business extensions literal in a %s structure", kind => {
    const { wire } = defaultFixture(), b = row(wire.sharedCandidateBoundaries[0].boundary), q = rows(b.qualifiers).at(-1)!;
    const target = kind === "qualifier" ? q : kind === "claim" ? row(q.value) : kind === "section" ? rows(b.editorialSectionBoundaries).at(-1)! : kind === "role" ? rows(b.editorialRoleBoundaries)[0] : row(b.sourceBoundary);
    target.futureBoundaryMetadata = { $reviewRef: "/literal/not-an-evidence-slot", use: "do_not_inherit", unknownReason: "literal extension" };
    const value = project(wire), projected = row(value.sharedCandidateBoundaries[0].boundary), pq = rows(projected.qualifiers).at(-1)!;
    const actual = kind === "qualifier" ? pq : kind === "claim" ? row(pq.value) : kind === "section" ? rows(projected.editorialSectionBoundaries).at(-1)! : kind === "role" ? rows(projected.editorialRoleBoundaries)[0] : row(projected.sourceBoundary);
    expect(actual).toEqual(target);
    if (kind === "claim") expect(pq.use).toBe(boundaryUse);
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it("keeps unsafe original property order inline instead of moving omitted keys", () => {
    const { wire } = defaultFixture(), b = row(wire.sharedCandidateBoundaries[0].boundary), q = rows(b.qualifiers).at(-1)!, originalClaim = row(q.value);
    q.value = { unknownReason: originalClaim.unknownReason, ...originalClaim };
    const section = rows(b.editorialSectionBoundaries).at(-1)!;
    rows(b.editorialSectionBoundaries).splice(-1, 1, { use: section.use, ...section });
    const value = project(wire), projected = row(value.sharedCandidateBoundaries[0].boundary);
    expect(Object.keys(row(rows(projected.qualifiers).at(-1)!.value))[0]).toBe("unknownReason");
    expect(Object.keys(rows(projected.editorialSectionBoundaries).at(-1)!)[0]).toBe("use");
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it.each(["use", "unknownReason"])("falls back to legacy sharing if original %s is absent rather than inventing it", key => {
    const { wire } = defaultFixture(), q = rows(row(wire.sharedCandidateBoundaries[0].boundary).qualifiers).at(-1)!;
    delete (key === "use" ? q : row(q.value))[key];
    const value = project(wire);
    expect(Reflect.get(value, "reviewProjection")).toBe("saitu.review-exact-projection.v1");
    expect(value).not.toHaveProperty("reviewBoundaryDefaults");
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it("keeps original absent fields absent in an extended business object while other known rows use v2", () => {
    const { wire } = defaultFixture(), q = rows(row(wire.sharedCandidateBoundaries[0].boundary).qualifiers).at(-1)!;
    q.futureSchema = "literal extension, outside local default types";
    row(q.value).futureClaimData = { unknownReason: "nested literal, never a default" };
    delete q.use; delete row(q.value).unknownReason;
    const value = project(wire), projectedQualifier = rows(row(value.sharedCandidateBoundaries[0].boundary).qualifiers).at(-1)!;
    expect(Reflect.get(value, "reviewProjection")).toBe(REVIEW_PACKET_PROJECTION_VERSION_V7);
    expect(projectedQualifier).toEqual(q);
    expect(projectedQualifier).not.toHaveProperty("use"); expect(row(projectedQualifier.value)).not.toHaveProperty("unknownReason");
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it("retains a nonstandard parent purpose without activating defaults", () => {
    const { wire } = defaultFixture();
    row(wire.sharedCandidateBoundaries[0].boundary).use = "different_parent_scope";
    const value = project(wire);
    expect(Reflect.get(value, "reviewProjection")).toBe("saitu.review-exact-projection.v1");
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it("handles additional same-owner boundary positions without changing the original fixed order or keys", () => {
    const { wire } = defaultFixture(), entry = wire.sharedCandidateBoundaries.pop()!;
    wire.assertions.pop();
    Object.assign(wire, { additionalCandidateBoundaries: [entry.boundary] });
    const value = project(wire), additional = Reflect.get(value, "additionalCandidateBoundaries") as JsonRow[];
    expect(rows(additional[0].qualifiers).at(-1)).not.toHaveProperty("use");
    expect(value.fixedOrder).toEqual(wire.fixedOrder);
    expect(value.assertions.map(assertion => assertion.key)).toEqual(wire.assertions.map(assertion => assertion.key));
    expect(JSON.stringify(expandReviewPacketV7(value))).toBe(JSON.stringify(wire));
  });

  it.each(["extra-key", "wrong-use", "wrong-unknown", "missing-descriptor", "future-version"])("rejects %s in the explicit v2 protocol", kind => {
    const value = project(defaultFixture().wire), descriptor = row(Reflect.get(value, "reviewBoundaryDefaults"));
    if (kind === "extra-key") descriptor.futureDefault = true;
    else if (kind === "wrong-use") descriptor.use = "cross_owner";
    else if (kind === "wrong-unknown") descriptor.unknownReason = "empty_string";
    else if (kind === "missing-descriptor") Reflect.deleteProperty(value, "reviewBoundaryDefaults");
    else Reflect.set(value, "reviewProjection", "saitu.review-exact-projection.v3");
    expect(() => expandReviewPacketV7(value)).toThrow("invalid_review_projection_packet");
  });

  it.each(["boundary", "displayed", "qualifier", "claim", "section", "role", "source", "duplicate-owner", "outside-fixed-order"])("rejects %s owner tampering before applying inherited defaults", kind => {
    const value = project(defaultFixture().wire), entry = value.sharedCandidateBoundaries[0], b = row(entry.boundary), q = rows(b.qualifiers).at(-1)!;
    const other = value.sharedCandidateBoundaries[1].itemId;
    if (kind === "boundary") b.itemId = other;
    else if (kind === "displayed") row(b.displayedRecommendation).itemId = other;
    else if (kind === "qualifier") q.ownerId = other;
    else if (kind === "claim") row(q.value).itemId = other;
    else if (kind === "section") rows(b.editorialSectionBoundaries).at(-1)!.ownerId = other;
    else if (kind === "role") rows(b.editorialRoleBoundaries)[0].ownerId = other;
    else if (kind === "source") row(b.sourceBoundary).ownerId = other;
    else if (kind === "duplicate-owner") value.sharedCandidateBoundaries.push(structuredClone(entry));
    else value.fixedOrder.itemIds = value.fixedOrder.itemIds.filter(id => id !== entry.itemId);
    expect(() => expandReviewPacketV7(value)).toThrow("invalid_review_projection_packet");
  });

  it("reads an independent static v1 packet exactly, including an unrelated literal defaults extension", () => {
    const profileFact = { id: "S00", text: "仅本人做清理；队友建模。", state: "conditional", conditions: ["仍待确认"] };
    const expected = { profile: { facts: [profileFact] }, assertions: [{ itemId: "C00", reason: { text: "原理由完整保留", kind: "inference" }, citedStudentFacts: [profileFact], studentAnswerUpdates: [], studentCounterEvidence: { negated: [], retracted: ["S-old"] }, competitionItems: [] }], sharedCandidateBoundaries: [], reviewBoundaryDefaults: { unknownLiteral: { use: "do_not_decode" } } };
    const legacy = structuredClone(expected);
    legacy.assertions[0].citedStudentFacts[0] = { $reviewRef: "/profile/facts/0" } as unknown as typeof profileFact;
    Object.assign(legacy, { reviewProjection: "saitu.review-exact-projection.v1" });
    expect(JSON.stringify(expandReviewPacketV7(legacy))).toBe(JSON.stringify(expected));
    expect(() => projectReviewPacketV7(expected)).toThrow("invalid_review_projection_packet");
  });
});
