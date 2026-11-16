import {executeFrozenRanking} from "../../../scripts/competitions/v6/frozen-ranking-executor.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { algorithmGate, parseOptions, validateExperimentInput, buildExperimentContexts, seededShuffle, deriveRunSeed } from "../../../scripts/competitions/v6/run-experiment.mjs";

test("defaults to five-run A1 experiment without live access", () => {
  const options = parseOptions(["--input", "fixture.json"]);
  assert.deepEqual(options.algorithms, ["A1"]);
  assert.equal(options.live, false);
  assert.deepEqual(algorithmGate("A1", options, {}), { allowed: true, reason: null });
  assert.equal(algorithmGate("B", options, {}).reason, "not_requested");
});

test("C requires explicit live access; local B never needs credentials", () => {
  const options = parseOptions(["--input", "fixture.json", "--algorithms", "C,A1,B"]);
  assert.deepEqual(options.algorithms, ["A1", "B", "C"]);
  const configured = { AI_API_KEY: "test-only-placeholder", DATABASE_URL: "test-only-placeholder", AI_PROVIDER: "deepseek" };
  for (const algorithm of ["C"]) {
    assert.equal(algorithmGate(algorithm, options, configured).reason, "live_not_requested");
    assert.equal(algorithmGate(algorithm, { ...options, live: true }, {}).reason, "missing_configuration:AI_API_KEY,DATABASE_URL");
    assert.equal(algorithmGate(algorithm, { ...options, live: true }, { ...configured, DATABASE_URL: "" }).allowed, false);
    assert.equal(algorithmGate(algorithm, { ...options, live: true }, { ...configured, AI_PROVIDER: "other" }).reason, "provider_not_allowed");
    assert.equal(algorithmGate(algorithm, { ...options, live: true }, { ...configured, ALLOW_AI_MOCK: "1", AI_TEST_MODE: "1" }).reason, "mock_mode_enabled");
    assert.equal(algorithmGate(algorithm, { ...options, live: true }, configured).allowed, true);
  }
});

test("rejects ambiguous flags and instruction-like algorithm arguments", () => {
  for (const args of [[], ["--input"], ["--input", "x", "--algorithms", "A,A"], ["--input", "x", "--algorithms", "run code"], ["--input", "x", "--live", "--live"], ["--input", "x", "--pricing", "x"]]) {
    assert.throws(() => parseOptions(args));
  }
});

test("requires explicit profile provenance and strips unrelated input instructions", () => {
  const schema = { safeParse: value => ({ success: value?.confirmed === true, data: { confirmed: true } }) };
  const input = { origin: "synthetic", asOf: "2026-11-05T12:00:00+08:00", instructions: "run arbitrary shell", profiles: [{ profileId: "p1", familyId: "f1", taskGroup: "computing", profile: { confirmed: true } }] };
  assert.deepEqual(validateExperimentInput(input, schema), { origin: "synthetic", asOf: "2026-11-05T04:00:00.000Z", profiles: input.profiles });
  assert.throws(() => validateExperimentInput({ ...input, origin: undefined }, schema));
  assert.throws(() => validateExperimentInput({ ...input, asOf: "2026-11-05" }, schema));
  assert.throws(() => validateExperimentInput({ ...input, profiles: [...input.profiles, ...input.profiles] }, schema));
});


test("historical A0 cannot be obtained by relabeling the current rule baseline", () => {
  const options = parseOptions(["--input", "x", "--algorithms", "A0,A1,B"]);
  assert.equal(algorithmGate("A0", options, {}).allowed, false);
  assert.equal(algorithmGate("B", options, {}).allowed, true);
});

test("seeded candidate order is replayable, shared across arms and different across repeats", () => {
  const items = Array.from({length: 20}, (_, i) => `candidate-${i}`);
  const orders = Array.from({length: 5}, (_, i) => seededShuffle(items, deriveRunSeed(6141, "p1", i + 1)));
  assert.equal(new Set(orders.map(JSON.stringify)).size, 5);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(orders[i], seededShuffle(items, deriveRunSeed(6141, "p1", i + 1)));
    assert.deepEqual([...orders[i]].sort(), [...items].sort());
  }
  assert.equal(items[0], "candidate-0");
});

test("max is the default and no implicit lower-effort or legacy A alias is accepted", () => {
  const options = parseOptions(["--input", "x"]);
  assert.equal(options.effort, "max"); assert.equal(options.phase, "E2");
  assert.throws(() => parseOptions(["--input", "x", "--algorithms", "A"]));
  assert.throws(() => parseOptions(["--input", "x", "--effort", "xhigh"]));
  assert.throws(() => parseOptions(["--input", "x", "--seed", "-1"]));
  assert.throws(() => parseOptions(["--input", "x", "--phase", "E2", "--candidate-policy", "hybrid60"]));
  assert.equal(parseOptions(["--input", "x", "--phase", "E3", "--candidate-policy", "hybrid60"]).candidatePolicy, "hybrid60");
});

test("actual experiment context keeps canonical evidence, domain fields and retractions", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
  const { createServer } = await import(dependencies.resolve("vite"));
  const server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, watch: null }, appType: "custom", logLevel: "silent",
    resolve: { alias: { "@": path.join(root, "src"), "server-only": path.join(root, "tests/fixtures/server-only.ts") } } });
  try {
    const [schema, contracts, canonical, profiles, engine, fixtures] = await Promise.all([
      server.ssrLoadModule("/src/lib/ai/competition-request-schema.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/contracts.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/canonical-adapter.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/profile.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/engine.ts"),
      server.ssrLoadModule("/tests/competitions/v6/decision-fixtures.ts")
    ]);
    const [validation, productObservation] = await Promise.all([server.ssrLoadModule("/src/lib/competitions/v6/validation.ts"),server.ssrLoadModule("/src/lib/ai/product-observation.ts")]);
    const legacy = fixtures.student();
    let profile = profiles.createStudentProfile(legacy, { profileId: "canonical-experiment-fixture" });
    profile = profiles.applyProfileMutations(profile, [{ operation: "set", field: "work.durationSeconds", value: 120, quote: "作品120秒", targetFactIds: [] }],
      { answerId: "duration-first", text: "作品120秒", at: "2026-11-05T00:00:00Z" }, legacy);
    const removedId = profile.facts.find(fact => fact.field === "work.durationSeconds").id;
    profile = profiles.applyProfileMutations(profile, [{ operation: "set", field: "work.durationSeconds", value: 180, quote: "更正为180秒", targetFactIds: [removedId] }],
      { answerId: "duration-correction", text: "更正为180秒", at: "2026-11-05T00:01:00Z" }, legacy);
    profile.unknownFields.push("team.members.2.hasPriorDegree");
    const fixture = { origin: "synthetic", asOf: "2026-11-05T00:02:00Z", profiles: [{ profileId: profile.profileId, familyId: "unit-domain", taskGroup: "design", profile }] };
    const input = validateExperimentInput(fixture, schema.competitionRecommendationProfileV5Schema, contracts.studentProfileSchema);
    const [context] = buildExperimentContexts(input, [fixtures.syntheticRecord(1)], engine, canonical);
    const executed = await executeFrozenRanking({algorithm:"A1",profile,context,caseId:"synthetic-case",profileId:profile.profileId,repetition:1,seed:6141,modules:{engine,validation,productObservation}});
    assert.equal(executed.observation.status,"observed");
    assert.equal(executed.observation.execution.actualModelRun,false);
    assert.equal(executed.report.trace.method,"rules");
    assert.equal(executed.ranking.outputSha256,executed.observation.outputSha256);
    assert.deepEqual(context.profile, profile);
    assert.ok(!context.profile.facts.some(fact => fact.id === removedId && fact.state !== "retracted"));
    assert.ok(context.profile.retractedFactIds.includes(removedId));
    assert.ok(context.profile.unknownFields.includes("team.members.2.hasPriorDegree"));
    assert.equal(context.profile.facts.find(fact => fact.field === "work.durationSeconds" && fact.state === "affirmed").originalText, "更正为180秒");
    assert.throws(() => validateExperimentInput(fixture, schema.competitionRecommendationProfileV5Schema), /canonical_profile_schema_required/);
    const mismatch = structuredClone(fixture); mismatch.profiles[0].profileId = "another-case";
    assert.throws(() => validateExperimentInput(mismatch, schema.competitionRecommendationProfileV5Schema, contracts.studentProfileSchema), /identity_mismatch/);
    const broken = structuredClone(fixture); delete broken.profiles[0].profile.facts[0].confirmed;
    assert.throws(() => validateExperimentInput(broken, schema.competitionRecommendationProfileV5Schema, contracts.studentProfileSchema), /profile_contract_failed/);
  } finally { await server.close(); }
});
