import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectFast24, prepareFast24, readFast24, runFast24, summarizeFast24, exportBlindPackets, assessIndependentQuality } from "./fast24.mjs";
import { FAST24 } from "./fast24-config.mjs";
import { byteHash, canonicalHash } from "./evaluation-policy.mjs";

function fixture() {
  const product = { asOf: "2026-11-09T00:00:00+08:00", cases: [] }, ranking = { asOf: product.asOf, profiles: [] };
  for (const [operation, count] of Object.entries(FAST24.counts).filter(([key]) => key !== "ranking"))
    for (let index = 0; index < count + (operation === "constraint_check" ? 0 : 3); index++)
      product.cases.push({ caseId: `${operation}-${index}`, familyId: `family-${operation}-${index}`, templateFamilyId: `template-${operation}-${index}`,
        operation, taskGroup: "cross_task", input: { fixture: `${operation}-${index}`,
          ...(operation === "extract_profile" && index === 0 ? { requestedFields: ["translation_role"], utterance: "初稿由别人翻译，我只核对术语。" } : {}) } });
  for (const taskGroup of FAST24.groups) for (let index = 0; index < 8; index++) ranking.profiles.push({ caseId: `${taskGroup}-${index}`,
    profileId: `${taskGroup}-${index}`, familyId: `family-${taskGroup}-${index}`, taskGroup, input: { fixture: `${taskGroup}-${index}` } });
  return { product, ranking, exclusions: { developmentFamilyIds: [], developmentTemplateFamilyIds: [], developmentInputSha256: [] } };
}

async function preparedFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "saitu-fast24-test-")), sources = fixture();
  for (const [name, value] of Object.entries(sources)) await writeFile(path.join(directory, `${name}.json`), JSON.stringify(value));
  const output = path.join(directory, "run");
  await prepareFast24({ output, productSource: path.join(directory, "product.json"), rankingSource: path.join(directory, "ranking.json"), developmentExclusions: path.join(directory, "exclusions.json") });
  return { directory, output, ...await readFast24(output) };
}

test("input-only deterministic selection fixes396 identities and all468 original slots", () => {
  const source = fixture(), first = selectFast24(source), second = selectFast24({ ...source, product: { ...source.product, cases: [...source.product.cases].reverse() }, ranking: { ...source.ranking, profiles: [...source.ranking.profiles].reverse() } });
  assert.deepEqual(first, second); assert.equal(first.product.cases.length, 372); assert.equal(first.ranking.profiles.length, 24);
  assert.equal(first.slots.length, 468); assert.equal(first.slots.filter(row => row.algorithm === "C").length, 48);
  assert.equal(first.blindPairs.length, 12);
  assert(first.product.cases.some(row => row.input.requestedFields?.includes("translation_role")));
  for (const group of FAST24.groups) assert.equal(first.ranking.profiles.filter(row => row.taskGroup === group).length, 4);
  for (const pair of first.blindPairs) {
    assert.equal(pair.leftSlotId.slice(-1), "0"); assert.equal(pair.rightSlotId.slice(-1), "0");
    assert.deepEqual([pair.leftSlotId.split(":").at(-2), pair.rightSlotId.split(":").at(-2)].sort(), ["B", "C"]);
  }
});

test("development families, templates and exact input fingerprints are excluded before sampling", () => {
  const source = fixture(), rows = source.ranking.profiles.slice(0, 3);
  source.exclusions.developmentFamilyIds.push(rows[0].familyId);
  source.exclusions.developmentTemplateFamilyIds.push("dev-template"); rows[1].templateFamilyId = "dev-template";
  source.exclusions.developmentInputSha256.push(canonicalHash(rows[2].input));
  const selected = selectFast24(source);
  assert(rows.every(row => !selected.ranking.profiles.some(picked => picked.caseId === row.caseId)));
  source.exclusions.developmentFamilyIds.push(source.product.cases[0].familyId);
  assert.throws(() => selectFast24(source), /all_300_constraints_required/);
});

test("errors and orphaned intents remain original denominator entries across resume", async () => {
  const prepared = await preparedFixture();
  try {
    const slots = prepared.manifest.slots.slice(0, 3), calls = [];
    const modules = { catalog: { getMatchingCatalogRecords: () => [] } };
    const execute = async (item, options) => {
      calls.push(item.caseId); options.journal({ type: "test_original_started", caseId: item.caseId });
      if (item.caseId === slots[1].caseId) throw new Error("dispatched_provider_outcome_unknown");
      return { observation: { caseId: item.caseId, repetition: options.repetition, inputSha256: canonicalHash(item.input),
        invocationId: `original-${item.caseId}`, outputSha256: canonicalHash(null), output: null, status: "error", error: "actual_product_error",
        execution: { httpDispatches: 0 }, reservationIds: [] }, responses: [] };
    };
    const options = { output: prepared.output, modules, execute, slotIds: slots.map(row => row.slotId), sampleResources: () => ({ initialConcurrency: 1, capacity: 1 }) };
    await runFast24(options);
    const first = await summarizeFast24(prepared.output); assert.equal(first.slots[0].status, "error"); assert.equal(first.slots[1].status, "indeterminate");
    await runFast24(options);
    assert.equal(calls.filter(id => id === slots[0].caseId).length, 1); assert.equal(calls.filter(id => id === slots[1].caseId).length, 1);
    const summary = await summarizeFast24(prepared.output); assert.equal(summary.expectedSlots, 468); assert.equal(summary.slots[1].status, "indeterminate");
    assert.equal(summary.independentQualityAcceptance, "pending_E_review");
    await assert.rejects(runFast24({ ...options, phase: "ranking", slotIds: undefined }), /root_execute_paid/);
    await assert.rejects(exportBlindPackets(prepared.output), /blind_pair_original_not_recorded/);
  } finally { await rm(prepared.directory, { recursive: true, force: true }); }
});

test("input byte tampering is rejected before a new original can be dispatched", async () => {
  const prepared = await preparedFixture();
  try {
    await writeFile(path.join(prepared.output, "inputs/product.json"), (await readFile(path.join(prepared.output, "inputs/product.json"))) + " ");
    await assert.rejects(readFast24(prepared.output), /selected_input_bytes_changed/);
  } finally { await rm(prepared.directory, { recursive: true, force: true }); }
});

test("a refined selection references applicable original constraints without dispatching them again", async () => {
  const prepared = await preparedFixture();
  try {
    const slot = prepared.manifest.slots[0], item = prepared.rows.find(row => row.caseId === slot.caseId), original = path.join(prepared.directory, "retained-original.json");
    const result = { observation: { caseId: item.caseId, repetition: 0, inputSha256: canonicalHash(item.input), invocationId: "unchanged-original-id",
      outputSha256: canonicalHash({ preserved: true }), output: { preserved: true }, status: "observed", error: null, execution: { httpDispatches: 0 }, reservationIds: [] }, responses: [] };
    await writeFile(original, JSON.stringify(result));
    const next = path.join(prepared.directory, "v2"); await mkdir(next); await cp(path.join(prepared.output, "inputs"), path.join(next, "inputs"), { recursive: true });
    await writeFile(path.join(next, "manifest.json"), JSON.stringify({ ...prepared.manifest, selectionRevision: 2,
      inheritedOriginals: [{ slotId: slot.slotId, selectionSha256: prepared.selectionSha256, original: { path: original, sha256: byteHash(await readFile(original)) } }] }));
    let calls = 0;
    await runFast24({ output: next, slotIds: [slot.slotId], modules: { catalog: { getMatchingCatalogRecords: () => [] } },
      execute: async () => { calls++; throw new Error("must_not_repeat_retained_original"); }, sampleResources: () => ({ initialConcurrency: 1, capacity: 1 }) });
    assert.equal(calls, 0);
    const summary = await summarizeFast24(next); assert.equal(summary.slots[0].invocationId, "unchanged-original-id");
    assert.equal(summary.slots[0].inheritedFromSelectionSha256, prepared.selectionSha256);
    await writeFile(original, JSON.stringify({ altered: true }));
    await assert.rejects(summarizeFast24(next), /inherited_original_bytes_changed/);
  } finally { await rm(prepared.directory, { recursive: true, force: true }); }
});

test("quality accepts only complete independent, correctly bound, fixed-denominator aggregates", () => {
  const report = { schemaVersion: "saitu.fast24.independent-acceptance-summary.safe.v1", selectionSha256: "selection", reviewer: "independent-E", status: "complete", passed: true,
    metrics: { completeC: 46, fitMean: .9, groupFit: Object.fromEntries(FAST24.groups.map(group => [group, .8])), jaccardMean: .8, distinctFacts: 100,
      factAccuracy: .98, citationPrecision: .98, citationCoverage: .95, keyCoverage: 1, profileMicroF1: .95, correctionSuccess: 1, correctionIsolation: 1,
      conversationPasses: 11, robustnessPasses: 11, blindCNotWorse: 10 }, counts: { reviewedOutcomes: 468, constraintsReviewed: 300, constraintsPassed: 300 },
    criticalErrors: { fact: 0, attribution: 0, correction: 0, isolation: 0, constraint: 0 } };
  assert.equal(assessIndependentQuality(report, "selection").status, "passed");
  assert.equal(assessIndependentQuality({ ...report, status: "pending" }, "selection").status, "pending_E_review");
  assert.equal(assessIndependentQuality({ ...report, counts: { ...report.counts, reviewedOutcomes: 467 } }, "selection").status, "failed");
  assert.equal(assessIndependentQuality({ ...report, metrics: { ...report.metrics, distinctFacts: 99 } }, "selection").status, "failed");
  assert.equal(assessIndependentQuality({ ...report, criticalErrors: { ...report.criticalErrors, attribution: 1 } }, "selection").status, "failed");
  assert.throws(() => assessIndependentQuality(report, "different-selection"), /safe_summary_binding/);
  assert.throws(() => assessIndependentQuality({ ...report, expectedAtoms: [] }, "selection"), /safe_summary_binding/);
});
