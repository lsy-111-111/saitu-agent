import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { V7_NATIVE_ASSERTIONS, V7_NATIVE_EFFORT_ASSERTIONS, V7_NATIVE_TOP5_ASSERTIONS, validateNativeV7PostgresResult } from "../../scripts/lib/release-evidence-v7-postgres.mjs";
// @ts-expect-error The installed coordinator is intentionally plain JavaScript.
import { validateNativeV7PostgresEvidence as producerCheck } from "../../scripts/run-release-evidence.mjs";
// @ts-expect-error The independent installed verifier is intentionally plain JavaScript.
import { validateNativeV7PostgresEvidence as consumerCheck } from "../../ops/bin/verify-release-evidence.mjs";
// @ts-expect-error The read-only delivery contract is intentionally plain JavaScript.
import { runtimeInventory, verifyDeliveryShape, verifyWorkerBuildArtifacts } from "../../scripts/lib/release-evidence-v6-contract.mjs";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

describe("v7 native PostgreSQL signed evidence binding (synthetic verifier fixtures)", () => {
  function fixture(top5 = true, unbounded = true) {
    if (!top5) unbounded = false;
    const effortPolicy={version:"saitu.effort-policy.v1",rank:"low",explain:"low",review:"low"};
    const worker = { ...(unbounded?{executionMode:"user-unbounded"}:{}), sourceSha256: "a".repeat(64), artifactSha256: "b".repeat(64),effortPolicy,effortPolicySha256:sha(JSON.stringify(effortPolicy)) };
    const assertions=unbounded?V7_NATIVE_ASSERTIONS:top5?V7_NATIVE_TOP5_ASSERTIONS:V7_NATIVE_EFFORT_ASSERTIONS;
    const log = Buffer.from(assertions.map(value => `PASS ${value}\n`).join("") + JSON.stringify({ status: "passed", observations: assertions.length, paidCalls: 0, productionTouched: false, result: "/tmp/saitu-v7-native-TEST42/result.json" }) + "\n");
    const result = {
      schemaVersion: unbounded?"saitu.v7-ops-local-evidence.v4":"saitu.v7-ops-local-evidence.v3", status: "passed", database: "saitu_v7_ops_0123456789", postgresVersion: "14.24 (synthetic verifier fixture)",
      observations: [...assertions], workerBuild: {...(unbounded?{executionMode:"user-unbounded"}:{}),sourceSha256:worker.sourceSha256,artifactSha256:worker.artifactSha256,effortPolicySha256:worker.effortPolicySha256},
      stageGrantChain:{syntheticGrantInDisposableDatabase:true,grantVersion:"saitu.v7.effort.v1",effortPolicySha256:worker.effortPolicySha256,rankEffort:"low",authorizedReservations:2,chargedMicros:0,providerDispatches:0,configurationOnlyNextSeal:true}, paidCalls: 0, productionTouched: false,
      top5GrantChain:{syntheticGrantInDisposableDatabase:true,grantVersion:"saitu.v7.top5.v1",effortPolicySha256:worker.effortPolicySha256,rankEffort:"low",authorizedReservations:2,chargedMicros:0,providerDispatches:0,configurationOnlyNextSeal:true},
      ...(unbounded?{userUnboundedGrantChain:{syntheticGrantInDisposableDatabase:true,grantVersion:"saitu.v7.top5.user-unbounded.v1",executionMode:"user-unbounded",effortPolicySha256:worker.effortPolicySha256,rankEffort:"low",authorizedReservations:3,chargedMicros:0,providerDispatches:0,configurationOnlyNextSeal:true,physicalUnknownHoldRejected:true}}:{}),
      productionGrantChain: { syntheticGrantInDisposableDatabase: true, phase: "formal", configuredCalibrationCallLimit: 1, authoritativePgCallLimit: 2, authorizedReservations: 2, chargedMicros: 0, providerDispatches: 0, configurationOnlyNextSeal: true },
      execution: { platform: "linux", arch: "x64", node: "v24.20.0", source: "tests/deployment/v7-ops-postgres.test.mjs", sourceSha256: "c".repeat(64), rawLogSha256: sha(log) },
    };
    if(!top5){result.schemaVersion="saitu.v7-ops-local-evidence.v2";delete (result as Partial<typeof result>).top5GrantChain;}
    return { result, log, worker, sources: new Map([[result.execution.source, result.execution.sourceSha256],...(top5?[["db/migrations/20261109_spend_v7_top5_policy.sql","e".repeat(64)] as [string,string]]:[]),...(unbounded?[["db/migrations/20261109_spend_user_unbounded_execution.sql","f".repeat(64)] as [string,string]]:[])]) };
  }
  it("requires every native assertion and the exact production worker in both authorities", () => {
    for (const [top5,unbounded] of [[false,false],[true,false],[true,true]]) {
    const { result, log, worker, sources } = fixture(top5,unbounded);
    expect(validateNativeV7PostgresResult(result)).toBe(result);
    for (const check of [producerCheck, consumerCheck]) {
      expect(check(result, log, sources, worker)).toBe(true);
      const missing = structuredClone(result); missing.observations.pop();
      expect(() => check(missing, log, sources, worker)).toThrow(/incomplete or non-passing/);
      expect(() => check(result, log, sources, { ...worker, artifactSha256: "d".repeat(64) })).toThrow(/uniform production build/);
    }
    }
  });
  it("rejects a stale source, rewritten raw log and nonzero provider dispatch", () => {
    const { result, log, worker, sources } = fixture();
    for (const check of [producerCheck, consumerCheck]) {
      expect(() => check(result, log, new Map([...sources,[result.execution.source, "d".repeat(64)]]), worker)).toThrow(/binding differs/);
      expect(() => check(result, Buffer.concat([log, Buffer.from("tampered\n")]), sources, worker)).toThrow(/binding differs/);
      const substitutedPolicy=structuredClone(result);substitutedPolicy.stageGrantChain.effortPolicySha256="f".repeat(64);expect(()=>check(substitutedPolicy,log,sources,worker)).toThrow(/stage effort authority/);
      const top5=structuredClone(result); top5.top5GrantChain.grantVersion="saitu.v7.effort.v1"; expect(()=>check(top5,log,sources,worker)).toThrow(/top5 authority/);
      const mode = structuredClone(result); mode.workerBuild.executionMode="finite"; expect(()=>check(mode,log,sources,worker)).toThrow(/unbounded authority/);
      const holds = structuredClone(result); holds.userUnboundedGrantChain!.physicalUnknownHoldRejected=false; expect(()=>check(holds,log,sources,worker)).toThrow(/unbounded authority/);
      const dispatch = structuredClone(result); dispatch.productionGrantChain.providerDispatches = 1;
      expect(() => check(dispatch, log, sources, worker)).toThrow(/authority chain/);
      const omitted = structuredClone(result), shortened = Buffer.from(log.toString().replace(`PASS ${V7_NATIVE_ASSERTIONS[10]}\n`, ""));
      omitted.execution.rawLogSha256 = sha(shortened);
      expect(() => check(omitted, shortened, sources, worker)).toThrow(/required executed assertions/);
    }
  });
});

describe("v7 worker delivery closure (synthetic build artifacts)", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  function fixture(worker = true) {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "saitu-v7-delivery-test-"))); roots.push(root);
    const put = (name: string, bytes: string) => { const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes); };
    const buildId = "synthetic-build-only", sourceSha256 = "a".repeat(64);
    put(".next/BUILD_ID", `${buildId}\n`);
    put(".next/required-server-files.json", JSON.stringify({ version: 1, config: { distDir: ".next", env: { SAITU_V7_SOURCE_SHA256: sourceSha256 } }, files: [".next/server.js"] }));
    put(".next/server.js", "// synthetic Next artifact\n"); put("node_modules/next/package.json", '{"version":"15.5.24"}');
    const sourceName = worker ? "scripts/competitions/v7/worker-entry.ts" : "src/legacy.ts";
    put(sourceName, "// synthetic reviewed source\n");
    const source = [{ path: sourceName, sha256: sha(readFileSync(path.join(root, sourceName))) }];
    if (worker) {
      const bytes = 'export const fixture="synthetic worker only";\n', artifactSha256 = sha(bytes);
      const binding = JSON.stringify({ schemaVersion: "saitu.next-worker-binding.v7", sourceSha256, workerArtifactSha256: artifactSha256, nextBuildId: buildId });
      put(".next/decision-worker-binding.json", binding); put("dist/decision-worker/worker.mjs", bytes);
      put("dist/decision-worker/manifest.json", JSON.stringify({ schemaVersion: "saitu.worker-build.v7", sourceSha256, artifactSha256, nodeMajor: 24, inputs: [sourceName], nextBuildId: buildId, nextBindingSha256: sha(binding) }));
    }
    return { root, put, source, buildId, check: () => verifyDeliveryShape(root, source, runtimeInventory(root)), workerCheck: () => verifyWorkerBuildArtifacts(path.join(root, ".next"), path.join(root, "dist/decision-worker")) };
  }
  it("accepts the closed paired worker and preserves legacy releases without a worker marker", () => {
    const v7 = fixture(); expect(v7.check()).toBe(v7.buildId); expect(v7.workerCheck().sourceSha256).toBe("a".repeat(64));
    const legacy = fixture(false); expect(legacy.check()).toBe(legacy.buildId);
  });
  it("requires the frozen execution mode at the actual delivery entry for either new source marker", () => {
    for (const marker of ["src/lib/ai/execution-policy.mjs","db/migrations/20261109_spend_user_unbounded_execution.sql"]) {
      const value=fixture();value.put(marker,"// synthetic new execution source marker\n");
      value.source.push({path:marker,sha256:sha(readFileSync(path.join(value.root,marker)))});
      expect(()=>value.check()).toThrow(/execution_mode_required/);
      const standalone=()=>execFileSync(process.execPath,[path.join(process.cwd(),"ops/bin/verify-decision-worker-build.mjs"),value.root],{stdio:"pipe"});
      expect(standalone).toThrow();
      const binding=JSON.parse(readFileSync(path.join(value.root,".next/decision-worker-binding.json"),"utf8"));
      binding.executionMode="user-unbounded";const bytes=JSON.stringify(binding);value.put(".next/decision-worker-binding.json",bytes);
      const manifest=JSON.parse(readFileSync(path.join(value.root,"dist/decision-worker/manifest.json"),"utf8"));
      manifest.executionMode="user-unbounded";manifest.nextBindingSha256=sha(bytes);value.put("dist/decision-worker/manifest.json",JSON.stringify(manifest));
      const required=JSON.parse(readFileSync(path.join(value.root,".next/required-server-files.json"),"utf8"));
      required.config.env.SAITU_AI_EXECUTION_MODE="user-unbounded";value.put(".next/required-server-files.json",JSON.stringify(required));
      expect(value.check()).toBe(value.buildId);expect(JSON.parse(standalone().toString()).executionMode).toBe("user-unbounded");
    }
  });
  it("rejects arbitrary dist members, extra worker files and missing worker output", () => {
    const extra = fixture(); extra.put("dist/unreviewed.mjs", "// rejected\n"); expect(() => extra.check()).toThrow(/unreviewed_runtime_member/);
    const nested = fixture(); nested.put("dist/decision-worker/extra.mjs", "// rejected\n"); expect(() => nested.check()).toThrow(/unreviewed_runtime_member/);
    const missing = fixture(); rmSync(path.join(missing.root, "dist/decision-worker/worker.mjs")); expect(() => missing.check()).toThrow(/closed_artifact_required/);
  });
  it("rejects tampered bytes, a different compiled source and a linked worker", () => {
    const tampered = fixture(); tampered.put("dist/decision-worker/worker.mjs", "// changed after production build\n"); expect(() => tampered.check()).toThrow(/worker_artifact_changed/);
    const mismatch = fixture(); const required = JSON.parse(readFileSync(path.join(mismatch.root, ".next/required-server-files.json"), "utf8")); required.config.env.SAITU_V7_SOURCE_SHA256 = "f".repeat(64); mismatch.put(".next/required-server-files.json", JSON.stringify(required)); expect(() => mismatch.check()).toThrow(/worker_next_source_binding_changed/);
    const linked = fixture(); rmSync(path.join(linked.root, "dist/decision-worker/worker.mjs")); symlinkSync("manifest.json", path.join(linked.root, "dist/decision-worker/worker.mjs")); expect(() => linked.workerCheck()).toThrow(/closed_artifact_required/);
  });
});
