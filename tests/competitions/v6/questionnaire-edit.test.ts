import { describe,it,expect } from "vitest";
import { applyProfileMutations,createStudentProfile,mergeQuestionnaireEdits } from "@/lib/competitions/v6/profile";
import { changedContextFields } from "@/lib/competitions/v6/questionnaire-edit";
import { student } from "./decision-fixtures";
const at="2026-11-05T10:00:00.000Z";
describe("canonical questionnaire field merge",()=>{
  it("preserves chat-only qualifications and negative preferences across an old signed questionnaire edit",()=>{
    const base=student({decisionContext:{noviceTaskPreferences:[{task:"build-tool",preference:"avoid"}],unavailableResources:["lab"],budget:{scope:"personal",range:"100-500",maximumYuan:300}}});
    let profile=createStudentProfile(base);
    profile=applyProfileMutations(profile,[{operation:"set",field:"eligibility.age",value:18,targetFactIds:[],quote:"我18岁"}],{answerId:"chat-age",text:"我18岁",at},base);
    const incoming=student({weeklyCommitment:"over-10",confirmedFields:["stage","weeklyCommitment"]});
    const merged=mergeQuestionnaireEdits(profile,incoming,["weeklyCommitment"],{answerId:"edit-time",at});
    expect(merged.profileId).toBe(profile.profileId);expect(merged.revision).not.toBe(profile.revision);
    for(const field of ["eligibility.age","noviceTask","unavailableResource","budget.maximumYuan"]){expect(merged.facts.filter(f=>f.field===field)).toEqual(profile.facts.filter(f=>f.field===field));}
    expect(merged.facts.find(f=>f.field==="weeklyCommitment")?.value).toBe("over-10");
    expect(merged.updates?.at(-1)?.previousRevision).toBe(profile.revision);
  });
  it("removes only a deliberately cleared field and keeps unchanged context controls out of the patch",()=>{
    const base=student({skills:["programming"],confirmedFields:["stage","skills"],decisionContext:{budget:{range:"zero",scope:"personal"},noviceTaskPreferences:[{task:"build-tool",preference:"avoid"}]}}), profile=createStudentProfile(base);
    const merged=mergeQuestionnaireEdits(profile,student(),["skills"],{answerId:"clear-skills",at});
    expect(merged.facts.some(f=>f.field==="skills")).toBe(false);
    expect(merged.facts.filter(f=>f.field!=="skills")).toEqual(profile.facts.filter(f=>f.field!=="skills"));
    expect(changedContextFields({budget:{range:"zero"},unavailableResources:["mentor"]},{budget:{range:"under100"},unavailableResources:["mentor"]})).toEqual(["budget","budget.maximumYuan"]);
    expect(()=>mergeQuestionnaireEdits(profile,student(),["eligibility.age"],{answerId:"forge",at})).toThrow();
  });
});
