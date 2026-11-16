import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createStudentProfile } from "@/lib/competitions/v6/profile";
import {
  EXECUTABLE_SEED_ASSERTIONS, evaluatePublicSeeds, evaluateSeedAssertion, readPublicSeeds,
  type SeedObservation
} from "../../../scripts/competitions/v6/evaluate-seeds";
import { confirmedProfileFixture } from "./evaluation-seed-fixtures";

const seeds = readPublicSeeds();
const observations: SeedObservation[] = [];

describe("v6 public seed execution", () => {
  it("wires every one of the 96 public seeds to an implemented checker without inventing gold", () => {
    expect(seeds).toHaveLength(96);
    expect(new Set(seeds.map(seed => seed.familyId)).size).toBe(36);
    for (const seed of seeds) {
      expect(seed.goldRanking).toBeNull();
      for (const expectation of seed.expectations) expect(EXECUTABLE_SEED_ASSERTIONS).toContain(expectation.assertion);
    }
    const pending = evaluatePublicSeeds(seeds, []);
    expect(pending.counts.not_run).toBe(96);
    expect(pending.counts.passed_engineering).toBe(0);
    expect(pending.realModelCaseCount).toBe(0);
  });
  for (const seed of seeds.filter(seed => seed.layer === "profile")) {
    it(`${seed.caseId}: preserves confirmed-choice facts for ${seed.title}`, () => {
      const profile = createStudentProfile(confirmedProfileFixture(seed));
      const observation: SeedObservation = {
        caseId: seed.caseId, profile,
        provenance: {
          kind: "deterministic_engine", command: "node node_modules/vitest/vitest.mjs run tests/competitions/v6/evaluation-seeds.test.ts",
          artifact: "tests/competitions/v6/evaluation-seed-fixtures.ts",
          scope: "Confirmed-choice fixture → actual createStudentProfile. Free-text extraction and independent truth of self-report were not tested."
        }
      };
      const result = evaluatePublicSeeds([seed], [observation]);
      expect(result.results[0].status).toBe("passed_engineering");
      observations.push(observation);
    });
  }
  it("rejects an invented skill when the source fixture only expresses interest", () => {
    const seed = seeds.find(seed => seed.familyId === "P-interest")!;
    const profile = createStudentProfile(confirmedProfileFixture(seed));
    profile.facts.push({ id: "invented", field: "skills", value: "programming", label: "虚构编程能力", confirmed: true, state: "affirmed", evidenceLevel: "self_report" });
    const check = evaluateSeedAssertion("must_not_infer_experience", {
      caseId: seed.caseId, profile, provenance: { kind: "mock_provider", command: "negative fixture", artifact: "this test" }
    });
    expect(check.status).toBe("failed");
  });
  it("leaves unobserved submission rules and independent ranking judgment pending", () => {
    const observation: SeedObservation = { caseId: "SEED-013", provenance: { kind: "mock_provider", command: "missing output fixture", artifact: "this test" } };
    expect(evaluateSeedAssertion("must_reject_group_submission", observation).status).toBe("not_run");
    expect(evaluateSeedAssertion("requires_independent_pool_judgments", observation).status).toBe("pending_independent_review");
    expect(() => evaluateSeedAssertion("invented_check", observation)).toThrow("Unimplemented");
  });
});

afterAll(() => {
  if (process.env.V6_WRITE_EVALUATION_ARTIFACTS !== "1") return;
  writeFileSync("artifacts/v6/evaluation/seed-profile-observations.json", JSON.stringify(observations, null, 2) + "\n");
});
