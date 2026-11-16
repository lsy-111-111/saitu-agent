import { describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as model from "@/lib/competitions/v7/model";
import * as chat from "@/lib/competitions/v7/chat";
import * as canonical from "@/lib/competitions/v6/canonical-adapter";
import * as profile from "@/lib/competitions/v6/profile";
import * as profileV7 from "@/lib/competitions/v7/profile";
import * as legacySchema from "@/lib/ai/competition-request-schema";
import { isDecisionEvidenceFact } from "@/lib/competitions/v6/evidence";
import { executeProductOperation, checkpointInvocation, checkpointRegisteredInvocation, acquireCoordinatorLock, runBoundedSlotQueue } from "../../../scripts/competitions/v7/evaluation-executor.mjs";
import { canonicalHash, byteHash } from "../../../scripts/competitions/v7/evaluation-policy.mjs";
import { sanitizeRankingCandidate } from "../../../scripts/competitions/v7/evaluation-packets.mjs";
import { student, syntheticRecord } from "../v6/decision-fixtures";

const modules = { model, chat, canonical, profile, profileV7, legacySchema };
const common = () => ({ modules, records: [syntheticRecord(1), syntheticRecord(2)], asOf: "2026-11-09T00:00:00Z", invocationId: "synthetic-contract-only",
  modelCall: async () => { throw new Error("unexpected_live_model_call"); }, deadlineEpochMs: Date.now() + 90000 });

describe("v7 actual product evaluation drivers", () => {
  it("uses the actual V7 context for constraint cases and never invents a current registration gate", async () => {
    const options = common(); options.records[0].registration.status = "closed";
    const output = await executeProductOperation({ caseId: "local-constraint", operation: "constraint_check", input: { legacy: student() } }, options);
    expect(output.candidateItemIds).toEqual(options.records.map(record => record.recordId)); expect(output.excluded).toEqual([]);
  });
  it("runs the actual conversation chat path and applies a clear correction without an extractor surrogate", async () => {
    const output = await executeProductOperation({ caseId: "local-correction", operation: "conversation", input: { legacy: student({ weeklyCommitment: "5-10", confirmedFields: ["stage", "weeklyCommitment"] }),
      turns: [{ text: "刚才填错了，每周8小时改成3小时" }] } }, common());
    expect(output.checkpoints).toHaveLength(1);
    expect(output.profile.facts.some((fact: any) => fact.field === "weeklyHours" && fact.value === 3 && fact.state === "affirmed")).toBe(true);
    expect(output.checkpoints[0].reply.profile.revision).toBe(output.profile.revision);
  });
  it("executes both explicit robustness sides through the real supported operation", async () => {
    const output = await executeProductOperation({ caseId: "local-invariant", operation: "robustness", input: {
      base: { operation: "constraint_check", input: { legacy: student() } }, perturbed: { operation: "constraint_check", input: { legacy: student({ interests: ["data"] }) } },
    } }, common());
    expect(output.baseResult.candidateItemIds).toEqual(output.perturbedResult.candidateItemIds);
  });
  it("accepts an unknown-stage canonical submission through the real production provenance helper without a fake legacy identity", async () => {
    const submitted = profileV7.createStudentProfileV7(student()); submitted.facts = submitted.facts.filter(fact => fact.field !== "stage"); submitted.unknownFields.push("stage");
    const before = canonicalHash(submitted), compatibility: any[] = [];
    const output = await executeProductOperation({ caseId: "unknown-stage", operation: "constraint_check", input: { profile: submitted } }, { ...common(), onCompatibility: (value: any) => compatibility.push(value) });
    expect(output.profile.facts.some((fact: any) => fact.field === "stage")).toBe(false); expect(canonicalHash(submitted)).toBe(before);
    expect(compatibility[0].adapter).toBe("materializeStructuredProfileV7"); expect(compatibility[0].provenance.historicalUtteranceInvented).toBe(false);
  });
  it("keeps a valid robustness base when the other side is explicitly rejected before any provider dispatch", async () => {
    let calls = 0;
    const output = await executeProductOperation({ caseId: "partial-rejection", operation: "robustness", input: {
      base: { operation: "extract_profile", input: { utterance: "我能整理数据", requestedFields: ["skills"] } },
      perturbed: { operation: "extract_profile", input: { utterance: "x".repeat(1601), requestedFields: ["skills"] } },
    } }, { ...common(), modelCall: async () => { calls++; return { ok: true, data: { facts: [{ field: "skills", value: "data-analysis", state: "affirmed", evidenceLevel: "self_report", confirmed: true, sourceText: "我能整理数据" }], unknownFields: [] }, model: "deepseek-flash", upstreamAttempted: true }; } });
    expect(calls).toBe(1); expect(output.baseResult.facts).toHaveLength(1); expect(output.baseOutcome.status).toBe("observed");
    expect(output.perturbedOutcome).toMatchObject({ status: "input_rejected", explicitInputRejection: true, error: "invalid_extraction_input" });
  });
  it("does not replay an interrupted invocation intent or a completed original", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "saitu-v7-intent-")); let calls = 0;
    try {
      await expect(checkpointInvocation(directory, { slot: "unknown" }, async () => { calls++; throw new Error("interrupted_after_possible_dispatch"); })).rejects.toThrow("interrupted");
      expect((await checkpointInvocation(directory, { slot: "unknown" }, async () => { calls++; return {}; })).kind).toBe("indeterminate");
      await checkpointInvocation(directory, { slot: "complete" }, async () => { calls++; return { original: "fixed" }; });
      expect((await checkpointInvocation(directory, { slot: "complete" }, async () => { calls++; return { changed: true }; })).value).toEqual({ original: "fixed" });
      expect(calls).toBe(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("v7 bounded invocation coordinator", () => {
  it("runs at most two independent invocations, preserves slot order and serializes checkpoint writes", async () => {
    let active = 0, peak = 0, writing = 0, peakWriting = 0;
    const result = await runBoundedSlotQueue(Array.from({ length: 8 }, (_, i) => i), { concurrency: 2, run: async slot => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, slot % 2 ? 1 : 3)); active--; return { kind: "completed", value: { slot } };
    }, onCheckpoint: async () => { writing++; peakWriting = Math.max(peakWriting, writing); await new Promise(resolve => setTimeout(resolve, 1)); writing--; } });
    expect(peak).toBe(2); expect(peakWriting).toBe(1); expect(result.outcomes.map(row => row.value.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); expect(result.failures).toEqual([]);
  });
  it("refuses a second live coordinator and never steals a lock with an unverified owner", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "saitu-v7-lock-"));
    try {
      const release = await acquireCoordinatorLock(directory, { registered: "one" });
      const bytes = await readFile(path.join(directory, "coordinator.lock.json"));
      await expect(acquireCoordinatorLock(directory, { registered: "one" })).rejects.toThrow("exclusive_coordinator");
      await expect(acquireCoordinatorLock(directory, { registered: "one" }, byteHash(bytes))).rejects.toThrow("process_may_still_be_alive");
      await release();
      const foreign = { pid: 999999, hostname: "a-different-host", identity: { registered: "one" } };
      await writeFile(path.join(directory, "coordinator.lock.json"), JSON.stringify(foreign));
      const foreignBytes = await readFile(path.join(directory, "coordinator.lock.json"));
      await expect(acquireCoordinatorLock(directory, { registered: "one" }, byteHash(foreignBytes))).rejects.toThrow("recovery_not_authorized");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("stops new slots when a coordinator checkpoint fails and reports the failure", async () => {
    const result = await runBoundedSlotQueue([0, 1, 2, 3], { concurrency: 1,
      run: async slot => ({ kind: "completed", value: { slot } }), onCheckpoint: async () => { throw new Error("disk_unavailable"); } });
    expect(result.outcomes[0].kind).toBe("completed"); expect(result.outcomes.slice(1).every(row => row.kind === "not_run")).toBe(true);
    expect(result.failures).toEqual([{ reason: "coordinator_checkpoint_failed", error: "Error: disk_unavailable" }]);
  });
  it("preserves a proved non-dispatched budget refusal and permits only a new explicit scope before a terminal original", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "saitu-v7-financial-resume-")); let calls = 0;
    const identity = { slot: "same-registered-slot" }, first = { runId: "scope-one" }, second = { runId: "scope-two" };
    try {
      const refused = async () => { calls++; return { observation: { status: "not_run", execution: { actualModelRun: false } }, receipt: { executionScope: first } }; };
      await checkpointRegisteredInvocation(directory, identity, first, refused);
      await checkpointRegisteredInvocation(directory, identity, first, refused); expect(calls).toBe(1);
      await checkpointRegisteredInvocation(directory, identity, second, async () => { calls++; return { observation: { status: "observed", execution: { actualModelRun: false } }, receipt: { executionScope: second } }; });
      const terminal = await checkpointRegisteredInvocation(directory, identity, { runId: "scope-three" }, async () => { calls++; throw new Error("must_not_repay"); });
      expect(calls).toBe(2); expect(terminal.value.observation.status).toBe("observed");
      expect((await readdir(path.join(directory, canonicalHash(identity)))).filter(name => name.endsWith(".intent.json"))).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("v7 blind packet factual closure", () => {
  it("uses the product evidence predicate and excludes pending facts and dangling section claims", () => {
    const record = syntheticRecord(1), pending = { ...record.facts[0], id: "pending-official-fact", status: "pending_review" as const };
    record.facts.push(pending); record.sections.task.push({ text: "This pending claim must not become ranking gold", kind: "official_fact", factIds: [pending.id], conditions: [] });
    const clean = sanitizeRankingCandidate(record, isDecisionEvidenceFact);
    expect(clean.facts.some((fact: any) => fact.id === pending.id)).toBe(false);
    expect(clean.sections.task.some((claim: any) => claim.factIds.includes(pending.id))).toBe(false);
    expect(clean.excludedFactMetadata.some((fact: any) => fact.id === pending.id)).toBe(true);
    const legal = new Set(clean.facts.map((fact: any) => fact.id));
    expect(Object.values(clean.sections).flat().every((claim: any) => claim.factIds.every((id: string) => legal.has(id)))).toBe(true);
  });
});
