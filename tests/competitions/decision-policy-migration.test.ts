import { describe,expect,it } from "vitest";
import { competitions } from "@/content/competitions";
import { scoreCompetitionRecommendations,getHardFilterReason } from "@/lib/competitions/scoring";
import { competitionHardNegativePersonas,competitionRankingHoldoutCases,QUALITY_BENCHMARK_NOW } from "../fixtures/competition-quality-personas";

/** Paired policy migration evidence; authored historical labels and their thresholds stay frozen. */
describe("five-dimensional evidence policy and adjustable constraints",()=>{
  it("separates adjustable team conditions from an explicit fixed-team conflict",()=>{
    const cases=competitionHardNegativePersonas.filter(p=>["team-size","same-institution"].includes(p.decisiveFact));
    expect(cases).toHaveLength(12);
    for(const persona of cases){
      const record=competitions.find(c=>c.id===persona.forbiddenCompetitionId)!;
      const adjustable={...persona.profile,decisionContext:{...persona.profile.decisionContext,fixedTeam:false}};
      const fixed={...persona.profile,decisionContext:{...persona.profile.decisionContext,fixedTeam:true}};
      expect(getHardFilterReason(record,adjustable),persona.id).toBeNull();
      expect(getHardFilterReason(record,fixed),persona.id).toBe(persona.expectedHardFilterReason);
      expect(scoreCompetitionRecommendations([record],adjustable,{now:QUALITY_BENCHMARK_NOW})[0]?.eligibility.status,persona.id).toBe("needs_clarification");
      expect(scoreCompetitionRecommendations([record],fixed,{now:QUALITY_BENCHMARK_NOW}),persona.id).toEqual([]);
    }
  });
  it("distinguishes resources not yet held from resources explicitly unavailable",()=>{
    const cases=competitionHardNegativePersonas.filter(p=>p.decisiveFact==="required-resource");expect(cases).toHaveLength(2);
    for(const persona of cases){
      const record=competitions.find(c=>c.id===persona.forbiddenCompetitionId)!;
      const missing=record.recommendation.requiredResources!.filter(r=>r!=="none"&&!persona.profile.availableResources.includes(r));
      expect(missing.length).toBeGreaterThan(0);
      const unknown={...persona.profile,decisionContext:{...persona.profile.decisionContext,unavailableResources:[]}};
      const unavailable={...persona.profile,decisionContext:{...persona.profile.decisionContext,unavailableResources:missing}};
      expect(getHardFilterReason(record,unknown)).toBeNull();
      expect(getHardFilterReason(record,unavailable)).toBe("required-resource-unavailable");
    }
  });
  it("uses five exact caps and does not claim school award recognition as known",()=>{
    const persona=competitionRankingHoldoutCases[0];
    const scored=scoreCompetitionRecommendations(competitions,{...persona.profile,goals:["award"]},{now:QUALITY_BENCHMARK_NOW});
    expect(scored.length).toBeGreaterThan(0);
    for(const candidate of scored){
      const fit=candidate.decisionFit!;
      for(const [field,cap] of Object.entries({goal:30,task:25,experience:20,readiness:15,growth:10})){
        expect(fit.dimensions[field as keyof typeof fit.dimensions]).toBeGreaterThanOrEqual(0);
        expect(fit.dimensions[field as keyof typeof fit.dimensions]).toBeLessThanOrEqual(cap);
      }
      expect(fit.lower).toBeCloseTo(Object.values(fit.dimensions).reduce((a,b)=>a+b,0),1);
      expect(fit.dimensions.goal).toBe(0);
      expect(fit.upper-fit.lower).toBeGreaterThanOrEqual(29.9);
    }
  });
  it("keeps unconfirmed robotics task transfer conditional despite generic engineering skills",()=>{
    const record=competitions.find(c=>c.id==="china-robot-ai")!;
    for(const id of ["rank-master-electronics","rank-doctorate-or-recent-electronics"]){
      const persona=competitionRankingHoldoutCases.find(p=>p.id===id)!;
      const scored=scoreCompetitionRecommendations([record],persona.profile,{now:QUALITY_BENCHMARK_NOW})[0]!;
      expect(scored.decisionFit!.dimensions.task,id).toBeLessThan(7.5);
      expect(scored.decisionFit!.actionable,id).toBe(false);
      const confirmed=scoreCompetitionRecommendations([record],persona.profile,{now:QUALITY_BENCHMARK_NOW,transcript:[{question:{questionId:"explicit-robotics",signalKey:"competition-fit",prompt:"确认更愿意参与哪种任务？",selection:"single",options:[{value:"robotics-integration",label:"机器人系统联调"},{value:"hardware-build",label:"通用硬件制作"}],allowsNote:true,maxNoteLength:120,impact:"material",estimatedPreferenceOutcomeChanges:2},answer:{selectedValues:["robotics-integration"]}}]})[0]!;
      expect(confirmed.decisionFit!.dimensions.task,id).toBeGreaterThan(scored.decisionFit!.dimensions.task);
    }
  });
});
