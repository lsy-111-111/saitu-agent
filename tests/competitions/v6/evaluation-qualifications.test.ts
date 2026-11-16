import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { getCompetitionCatalog } from "@/lib/competitions/catalog";
import { buildCompetitionQualificationSnapshot } from "@/lib/competitions/scoring";
import { buildDecisionContext } from "@/lib/competitions/v6/engine";
import { evaluatePublicSeeds, readPublicSeeds, type SeedObservation } from "../../../scripts/competitions/v6/evaluate-seeds";
import { seedBaseProfile } from "./evaluation-seed-fixtures";

const seeds = readPublicSeeds();
const observations: SeedObservation[] = [];
const supported = new Set(["F-4c-degree", "F-4c-institution", "F-4c-team", "F-chem-team", "F-edition-boundary"]);

describe("v6 public seed qualification checks against production rule adapters", () => {
  for (const seed of seeds.filter(seed => supported.has(seed.familyId))) {
    it(`${seed.caseId}: checks ${seed.title}`, () => {
      const p = seedBaseProfile();
      p.enrollmentStatus = "full-time-student"; p.teamUnit = "same-unit"; p.teamSize = "three";
      p.confirmedFacts = ["enrollmentStatus", "teamUnit", "teamSize"];
      p.decisionContext = { fixedTeam: true };
      if (seed.familyId === "F-4c-degree") p.stage = "master";
      if (seed.familyId === "F-4c-institution") p.teamUnit = "mixed-unit";
      if (seed.familyId === "F-4c-team") p.teamSize = "solo";
      if (seed.familyId === "F-chem-team") p.teamSize = "two";
      const series = String(seed.inputs.series);
      const now = new Date(seed.asOf);
      let qualification: NonNullable<SeedObservation["qualification"]>;
      if (seed.familyId === "F-edition-boundary") {
        p.participationTiming = "next-cycle-ok"; p.confirmedFields.push("participationTiming");
        const context = buildDecisionContext(p, { now });
        const candidate = context.candidates.find(item => item.record.seriesId === series);
        expect(candidate, "This fixture needs an actual L2 historical 4C record").toBeDefined();
        qualification = { status: candidate!.eligibility, conditions: candidate!.conditions, assessedEdition: candidate!.record.edition };
      } else {
        const competition = getCompetitionCatalog().find(item => item.id === series);
        expect(competition).toBeDefined();
        const actual = buildCompetitionQualificationSnapshot(p, [competition!], now).entries[0];
        qualification = { status: actual.status === "needs_clarification" ? "unknown" : actual.status,
          conditions: [...actual.reasons, ...(actual.hardFilterReason ? [actual.hardFilterReason] : [])],
          assessedEdition: competition!.recommendation.schedule.edition ?? "当前仓库规则快照未结构化届次，原文范围待独立复核" };
      }
      const observation: SeedObservation = { caseId: seed.caseId, qualification,
        provenance: { kind: "deterministic_engine", command: "node node_modules/vitest/vitest.mjs run tests/competitions/v6/evaluation-qualifications.test.ts",
          artifact: "tests/competitions/v6/evaluation-qualifications.test.ts",
          scope: "Production qualification adapter + current repository rule snapshot. Source facts remain pending independent review; current team declared fixed in this controlled fixture." } };
      observations.push(observation);
      expect(evaluatePublicSeeds([seed], [observation]).results[0].status).toBe("passed_engineering");
    });
  }
});

afterAll(() => {
  if (process.env.V6_WRITE_EVALUATION_ARTIFACTS !== "1") return;
  writeFileSync("artifacts/v6/evaluation/seed-qualification-observations.json", JSON.stringify(observations, null, 2) + "\n");
});
