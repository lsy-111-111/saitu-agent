import {expect,it} from "vitest";
import {competitions} from "@/content/competitions";
import {personalExperienceFit,assessDecisionFit} from "@/lib/competitions/decision-fit";
import {student} from "./v6/decision-fixtures";

it("requires an actual confirmed personal task before scoring legacy experience",()=>{
  const competition=competitions.find(c=>c.recommendation.skills.includes("programming"))!;
  const profile=student({skills:["programming"],evidence:["project"],experienceLevel:"project-or-award",confirmedFields:["skills","evidence","experienceLevel"],decisionContext:{experienceRole:"led"}});
  expect(personalExperienceFit(competition,profile)).toBeNull();
  const input={goal:undefined,task:null,experience:null,readiness:null,growth:null};
  expect(assessDecisionFit(competition,profile,input).evidence.experience).toEqual([]);
  profile.decisionContext!.experiences=[{id:"own-task",task:"实现小程序的表单校验代码",contribution:"independent",completion:"delivered",challenge:"",confirmed:true}];
  const independent=personalExperienceFit(competition,profile)!;
  expect(independent).toBeGreaterThan(0);
  const entry=profile.decisionContext!.experiences[0];entry.contribution="assisted";
  expect(personalExperienceFit(competition,profile)).toBeGreaterThan(0);
  expect(personalExperienceFit(competition,profile)).toBeLessThan(independent);
  entry.confirmed=false;expect(personalExperienceFit(competition,profile)).toBeNull();
  entry.confirmed=true;entry.contribution="observed";expect(personalExperienceFit(competition,profile)).toBeNull();
  entry.contribution="independent";entry.task="";expect(personalExperienceFit(competition,profile)).toBeNull();
  profile.decisionContext!.experiences=[];
  expect(personalExperienceFit(competition,profile)).toBeNull();
});
