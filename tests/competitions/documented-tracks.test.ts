import {describe,expect,it} from "vitest";
import {competitions} from "@/content/competitions";
import {buildCompetitionQualificationSnapshot,scoreCompetitionRecommendations} from "@/lib/competitions/scoring";
import {competitionAnchorPersonas} from "../fixtures/competition-quality-personas";

const master={...competitionAnchorPersonas[0]!.profile,stage:"master" as const,enrollmentStatus:"full-time-student" as const,
  confirmedFacts:["enrollmentStatus" as const],teamUnit:undefined,teamSize:undefined,firstHigherEducationYear:undefined};
function item(id:string) { return competitions.find(c=>c.id===id)!; }
describe("sourced competition tracks",()=>{
  it("provides original documents, edition scopes and a concrete task for nine previously unsplit series",()=>{
    for(const id of ["green-development","information-security","physics-experiment-innovation","culsc-life-sciences","energy-economics-academic-creativity","digital-building-innovation","future-designer-ncda","national-advertising-art","china-college-computer-design"]) {
      const c=item(id);const tracks=c.recommendation.tracks!;
      expect(tracks.length,id).toBeGreaterThan(1);
      expect(new Set(tracks.map(t=>t.id)).size).toBe(tracks.length);
      for(const track of tracks) {
        expect(track.document?.url).toMatch(/^https:\/\//);
        expect(track.document?.scope.length).toBeGreaterThan(10);
        expect(track.taskSummary?.length).toBeGreaterThan(10);
        expect(c.recommendation.supportingSources?.some(s=>s.evidenceRef===track.evidenceRef && s.url===track.document?.url)).toBe(true);
      }
    }
  });
  it("does not use the security open-work undergraduate rule to suppress the graduate challenge",()=>{
    const c=item("information-security");const [entry]=buildCompetitionQualificationSnapshot(master,[c]).entries;
    expect(entry!.tracks.find(t=>t.trackId==="open-security-work")!.status).toBe("ineligible");
    expect(entry!.tracks.find(t=>t.trackId==="security-challenge")!.status).toBe("needs_clarification");
    expect(scoreCompetitionRecommendations([c],master)[0]?.recommendedTrack?.id).toBe("security-challenge");
  });
  it("excludes graduates and explicitly part-time students from the eleven 2026 computer-design categories",()=>{
    const c=item("china-college-computer-design");
    for (const p of [master,{...master,stage:"undergraduate-1" as const,enrollmentStatus:"part-time-student" as const}]) {
      const [entry]=buildCompetitionQualificationSnapshot(p,[c]).entries;
      expect(entry!.tracks.length).toBe(11);
      expect(entry!.tracks.every(t=>t.status==="ineligible")).toBe(true);
    }
    const current={...master,stage:"undergraduate-2" as const};
    expect(buildCompetitionQualificationSnapshot(current,[c]).entries[0]!.tracks.some(t=>t.trackId==="computer-music"&&t.status!=="ineligible")).toBe(true);
  });
  it("does not apply the three-person physics teaching cap to the two experiment categories",()=>{
    const c=item("physics-experiment-innovation");
    const p={...master,stage:"undergraduate-2" as const,teamSize:"five" as const,confirmedFacts:[...master.confirmedFacts,"teamSize" as const],decisionContext:{fixedTeam:true}};
    const tracks=buildCompetitionQualificationSnapshot(p,[c]).entries[0]!.tracks;
    expect(tracks.find(t=>t.trackId==="physics-teaching")?.hardFilterReason).toBe("team-size-ineligible");
    expect(tracks.find(t=>t.trackId==="assigned-experiment")?.hardFilterReason).toBeNull();
  });
});
