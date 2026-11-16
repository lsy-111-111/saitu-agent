import "./mock-publication-boundary";
import { describe, expect, it } from "vitest";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { student, syntheticRecord } from "./decision-fixtures";

function newlyScopedTrack() {
  const record = syntheticRecord(400);
  record.seriesId = "china-college-computer-design";
  record.recordId = "test-new-v6-track";
  record.track = {id:"new-v6-task-not-in-v5",name:"合成新赛道"};
  record.identity = {editionId:"2026-test",trackId:record.track.id,groupId:"undergraduate",scopeId:"fixture-only",stageIds:[],supersedesRecordIds:[],legacyRecordIds:[]};
  record.registration.status = "closed";
  const fact = {...record.facts[0],id:"new-track-qualification",field:"eligibility",status:"verified_current" as const,
    entity:{editionId:record.identity.editionId,trackId:record.identity.trackId,groupId:record.identity.groupId,scopeId:record.identity.scopeId}};
  record.facts.push(fact);
  record.eligibilityRules = [{id:"new-track-undergraduate",field:"degree",operator:"eq",value:"undergraduate",factIds:[fact.id],note:"合成本科限定"}];
  return record;
}

describe("V6 track qualifications independent from old track identifiers", () => {
  it("uses the new track's own scoped evidence without borrowing an old score or excluding its new ID", () => {
    const record = newlyScopedTrack();
    const context = buildDecisionContext(student(), {records:[record]});
    expect(context.candidates).toHaveLength(1);
    expect(context.candidates[0].score).toBeNull();
    expect(context.candidates[0].eligibility).toBe("eligible");
  });
  it("still excludes a known qualification conflict in the new track", () => {
    const record = newlyScopedTrack();
    const context = buildDecisionContext(student({stage:"master"}), {records:[record]});
    expect(context.candidates).toHaveLength(0);
    expect(context.excluded.get(record.recordId)).toContain("冲突");
  });
  it.each(["missing_entity", "other_track", "unread_source"])("never upgrades %s into independently scoped qualification", (fault) => {
    const record = newlyScopedTrack();
    const fact = record.facts.find(f=>f.id==="new-track-qualification")!;
    if(fault==="missing_entity") delete fact.entity;
    if(fault==="other_track") fact.entity!.trackId="different-track";
    if(fault==="unread_source") record.sources[0].accessStatus="metadata_only";
    const context = buildDecisionContext(student(), {records:[record]});
    expect(context.candidates).toHaveLength(0);
    expect(context.excluded.get(record.recordId)).toContain("尚未对应");
  });
});
