import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
import { verifyFormalRegistration, validateFormalProfiles } from "./experiment-registration.mjs";
import { bindBatchOutput, openBatchLedger, checkpointedRanking } from "./ranking-batches.mjs";
import { METHODS, deriveRunSeed, seededShuffle, executeFrozenRanking, summarizeBoundRuns, canonicalHash, generationStatus } from "./frozen-ranking-executor.mjs";
import { runtimeConfiguration, runtimeConfigurationHash } from "./runtime-configuration.mjs";
export { METHODS, deriveRunSeed, seededShuffle };
const REPEATS = 5;
const ORIGINS = new Set(["synthetic", "reviewer", "synthetic_confirmed_choices_from_public_development_seeds", "ai_authored_sealed"]);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function parseOptions(args) {
  const result = { input: null, output: null, algorithms: ["A1"], live: false, help: false, phase: "E2", seed: 6141, effort: "max", e5Cache: null, candidatePolicy: "full" };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error("duplicate_cli_option");
    seen.add(flag);
    if (flag === "--live") result.live = true;
    else if (flag === "--resume") result.resume = true;
    else if (flag === "--defer-c") result.deferC = true;
    else if (flag === "--open") result.open = true;
    else if (flag === "--help") result.help = true;
    else if (["--input", "--output", "--algorithms", "--phase", "--seed", "--effort", "--e5-cache", "--candidate-policy", "--registration", "--registration-sha256"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("missing_cli_option_value");
      if (flag === "--registration") result.registration = path.resolve(value);
      if (flag === "--registration-sha256") result.registrationSha256 = value;
      if (flag === "--input") result.input = path.resolve(value);
      if (flag === "--output") result.output = path.resolve(value);
      if (flag === "--candidate-policy") { if (!["full", "hybrid60"].includes(value)) throw new Error("candidate_policy_must_be_full_or_hybrid60"); result.candidatePolicy = value; }
      if (flag === "--e5-cache") result.e5Cache = path.resolve(value);
      if (flag === "--phase") { if (!["E2", "E3"].includes(value)) throw new Error("phase_must_be_E2_or_E3"); result.phase = value; }
      if (flag === "--seed") { if (!/^\d+$/.test(value) || Number(value) > 4294967295) throw new Error("seed_must_be_uint32"); result.seed = Number(value); }
      if (flag === "--effort") { if (!["max", "high", "low"].includes(value)) throw new Error("effort_must_be_max_high_low"); result.effort = value; }
      if (flag === "--algorithms") {
        const algorithms = value.split(",");
        if (!algorithms.length || new Set(algorithms).size !== algorithms.length || algorithms.some(name => !Object.hasOwn(METHODS, name))) throw new Error("algorithms_must_be_unique_A0_A1_B_C");
        result.algorithms = Object.keys(METHODS).filter(name => algorithms.includes(name));
      }
    } else throw new Error("unsupported_cli_option");
  }
  if (!result.help && !result.input) throw new Error("input_required");
  if (result.phase === "E2" && result.candidatePolicy !== "full") throw new Error("E2_forbids_independent_recall");
  return result;
}

/** Returns status only; credential values are never returned or printed. */
export function algorithmGate(algorithm, options, environment = process.env) {
  if (!options.algorithms.includes(algorithm)) return { allowed: false, reason: "not_requested" };
  if (algorithm === "A0") return { allowed: false, reason: "historical_snapshot_adapter_required_A0_is_not_current_rules" };
  if (algorithm === "A1" || algorithm === "B") return { allowed: true, reason: null };
  if (!options.live) return { allowed: false, reason: "live_not_requested" };
  const missing = ["AI_API_KEY", "DATABASE_URL"].filter(name => !environment[name]?.trim());
  if (missing.length) return { allowed: false, reason: `missing_configuration:${missing.join(",")}` };
  if (environment.AI_PROVIDER?.trim().toLowerCase() !== "deepseek") return { allowed: false, reason: "provider_not_allowed" };
  if (environment.ALLOW_AI_MOCK === "1" && environment.AI_TEST_MODE === "1") return { allowed: false, reason: "mock_mode_enabled" };
  return { allowed: true, reason: null };
}

export function validateExperimentInput(input, profileSchema, canonicalSchema) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !ORIGINS.has(input.origin)) throw new Error("explicit_synthetic_or_reviewer_origin_required");
  if (typeof input.asOf !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf))) throw new Error("asOf_requires_valid_timestamp_with_timezone");
  if (!Array.isArray(input.profiles) || !input.profiles.length || input.profiles.length > 1000) throw new Error("profiles_required_max_1000");
  const ids = new Set();
  const profiles = input.profiles.map((item, index) => {
    if (!item || ["profileId", "familyId", "taskGroup"].some(field => typeof item[field] !== "string" || !item[field].trim() || item[field].length > 180)) throw new Error(`invalid_profile_identity_at_${index + 1}`);
    if (ids.has(item.profileId)) throw new Error("duplicate_profileId");
    ids.add(item.profileId);
    const canonical = item.profile?.schemaVersion === "saitu.profile.v6";
    if (canonical && !canonicalSchema) throw new Error("canonical_profile_schema_required");
    if (item.profile?.schemaVersion && !canonical) throw new Error("unsupported_profile_schema");
    const parsed = (canonical ? canonicalSchema : profileSchema).safeParse(item.profile);
    if (!parsed.success) throw new Error(`profile_contract_failed_at_${index + 1}`);
    if (canonical && parsed.data.profileId !== item.profileId) throw new Error("canonical_profile_identity_mismatch");
    if (item.input && canonicalHash(item.input.profile) !== canonicalHash(item.profile)) throw new Error("sealed_input_profile_mismatch");
    return { profileId: item.profileId, familyId: item.familyId, taskGroup: item.taskGroup, profile: parsed.data,
      ...(item.caseId ? {caseId:item.caseId} : {}), ...(item.input ? {input:item.input} : {}) };
  });
  return { asOf: new Date(input.asOf).toISOString(), origin: input.origin, profiles };
}

/** Preserve V6 evidence and retractions; the V5 projection is only a compatibility view. */
export function buildExperimentContexts(input, records, engine, canonicalAdapter) {
  return input.profiles.map(item => {
    const options = { records, now: new Date(input.asOf), profileId: item.profileId };
    if (item.profile.schemaVersion === "saitu.profile.v6") {
      const { profile, legacy } = canonicalAdapter.canonicalProfileInput(item.profile);
      return engine.buildDecisionContext(deepFreeze(legacy), { ...options, profile: deepFreeze(profile) });
    }
    return engine.buildDecisionContext(deepFreeze(item.profile), options);
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function frozenContextSnapshot(context) {
  return {
    profile: context.profile, asOf: context.now.toISOString(), catalogVersion: context.catalogVersion,
    candidates: context.candidates.map(candidate => ({ itemId: candidate.record.recordId, seriesId: candidate.record.seriesId, name: candidate.record.name,
      trackLabel: candidate.record.track.name, eligibility: candidate.eligibility, relevantToConfirmedTasks: candidate.relevant,
      conditions: candidate.conditions, ruleScore: candidate.nativeScore })),
    excluded: [...context.excluded].map(([itemId, reason]) => ({ itemId, reason }))
  };
}

function safeSerialize(value) {
  const secrets = [process.env.AI_API_KEY, process.env.DATABASE_URL].filter(secret => typeof secret === "string" && secret.length > 0);
  return JSON.stringify(value, (_key, entry) => typeof entry === "string"
    ? secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), entry) : entry, 2) + "\n";
}


export async function sourceManifest(repositoryRoot) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("symlink_in_source_manifest");
      if (entry.isDirectory() && entry.name !== "__pycache__") await walk(filename);
      else if (entry.isFile() && !entry.name.endsWith(".pyc") && entry.name !== ".DS_Store") files.push(filename);
    }
  }
  await walk(path.join(repositoryRoot, "src"));
  await walk(path.join(repositoryRoot, "db"));
  await walk(path.join(repositoryRoot, "scripts"));
  await walk(path.join(repositoryRoot, "ops"));
  await walk(path.join(repositoryRoot, "public"));
  const configurations = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".eslintrc.json", ".eslintignore", "tsconfig.json", "next.config.mjs",
    // next-env.d.ts is generated by Next for the chosen distDir. Its exact
    // post-build bytes are recorded with build artifacts, not authored inputs.
    "postcss.config.mjs", "postcss.config.js", "tailwind.config.ts", "vitest.config.ts", "playwright.config.ts",
    "tests/fixtures/server-only.ts", "tests/fixtures/mock-spend-ledger.setup.ts"];
  for (const member of configurations) {
    const filename = path.join(repositoryRoot, member);
    const metadata = await lstat(filename).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (metadata?.isSymbolicLink()) throw new Error("symlink_in_source_manifest");
    if (metadata?.isFile()) files.push(filename);
  }
  return Promise.all(files.sort().map(async filename => ({ path: path.relative(repositoryRoot, filename), sha256: createHash("sha256").update(await readFile(filename)).digest("hex") })));
}

export async function executeExperiment(options) {
  // The E3 configuration surface is reserved; no retrieval claim without a frozen protocol.
  if (options.phase === "E3") throw new Error("E3_not_registered_requires_frozen_retrieval_protocol");
  if (options.open && !options.registration) throw new Error("formal_registration_required");
  const frozenImplementation = await sourceManifest(root);
  const runtime = runtimeConfiguration(), runtimeSha256 = canonicalHash(runtime);
  const registration = await verifyFormalRegistration(options, frozenImplementation);
  const batch = registration?.config.batchPolicy;
  if (options.deferC && !batch) throw new Error("defer_c_requires_registered_full_batch");
  if (options.resume && !batch) throw new Error("resume_requires_preregistered_batch_policy");
  if (batch && !options.live) throw new Error("formal_batch_requires_live_preregistered_arms");
  const ledger = batch ? await openBatchLedger(options.registrationSha256) : null;
  try { return await runExperiment(options, { registration, batch, ledger, frozenImplementation, runtime, runtimeSha256 }); }
  finally { await ledger?.close(); }
}

async function runExperiment(options, { registration, batch, ledger, frozenImplementation, runtime, runtimeSha256 }) {
  let openingTime;
  if (registration && options.resume) {
    await bindBatchOutput(options.registration, options.registrationSha256, options.output, true);
    const opening = JSON.parse(await readFile(path.join(options.output, "opening.json"), "utf8"));
    const registeredBytes = await readFile(path.join(options.output, "registration.json"));
    if (opening.registrationSha256 !== options.registrationSha256 || opening.inputSha256 !== registration.config.inputSha256 ||
        createHash("sha256").update(registeredBytes).digest("hex") !== options.registrationSha256)
      throw new Error("original_batch_opening_mismatch");
    try { await lstat(path.join(options.output, "freeze-manifest.json")); throw new Error("formal_matrix_already_finalized"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    openingTime = opening.openedAt;
  } else if (registration) {
    await mkdir(path.dirname(options.output),{recursive:true});
    await mkdir(options.output);
    if (batch) await bindBatchOutput(options.registration, options.registrationSha256, options.output, false);
    openingTime = new Date().toISOString();
    await writeFile(path.join(options.output,"opening.json"),safeSerialize({openedAt:openingTime,registrationSha256:options.registrationSha256,inputSha256:registration.config.inputSha256,privateAnswerKeysRead:false}),{flag:"wx"});
    await writeFile(path.join(options.output,"registration.json"),await readFile(options.registration),{flag:"wx",mode:0o600});
  }
  const inputBytes = await readFile(options.input);
  if (registration && createHash("sha256").update(inputBytes).digest("hex") !== registration.config.inputSha256) throw new Error("formal_input_hash_mismatch");
  const inputData = JSON.parse(inputBytes);
  let embeddingProvider;
  const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
  const { createServer } = await import(dependencies.resolve("vite"));
  const server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null },
    resolve: { alias: { "@": path.join(root, "src"), "server-only": path.join(root, "tests/fixtures/server-only.ts") } },
    appType: "custom", logLevel: "silent" });
  try {
    const [catalogModule, schemaModule, engine, model, evaluation, hybrid, validation, contracts, canonicalAdapter, productObservation] = await Promise.all([
      server.ssrLoadModule("/src/lib/competitions/v6/catalog.ts"),
      server.ssrLoadModule("/src/lib/ai/competition-request-schema.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/engine.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/model.ts"),
      server.ssrLoadModule("/scripts/competitions/v6/evaluate-rankings.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/hybrid-retrieval.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/validation.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/contracts.ts"),
      server.ssrLoadModule("/src/lib/competitions/v6/canonical-adapter.ts"),
      server.ssrLoadModule("/src/lib/ai/product-observation.ts")
    ]);
    const input = validateExperimentInput(inputData, schemaModule.competitionRecommendationProfileV5Schema, contracts.studentProfileSchema);
    if (registration) validateFormalProfiles(input);
    const implementation = frozenImplementation;
    const implementationSha256 = canonicalHash(implementation);
    const records = deepFreeze(structuredClone(catalogModule.getDecisionCatalog()));
    const catalogHash = canonicalHash(records);
    const contexts = buildExperimentContexts(input, records, engine, canonicalAdapter);
    const snapshots = contexts.map(frozenContextSnapshot);
    const contextHashes = snapshots.map(digest);
    if (new Set(contexts.map(context => context.catalogVersion)).size !== 1) throw new Error("catalog_version_changed_between_profiles");
    const catalogVersion = contexts[0].catalogVersion;
    const startedAt = openingTime ?? new Date().toISOString();
    const output = options.output ?? path.join(root, "artifacts/v6/experiments", startedAt.replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
    await mkdir(path.dirname(output), { recursive: true });
    if (!registration) try { await mkdir(output); } catch { throw new Error("output_directory_must_be_new"); }
    for (const name of ["runs", "stages", "observations", ...(batch ? ["checkpoints"] : [])]) {
      await mkdir(path.join(output, name), { recursive: Boolean(options.resume), mode: 0o700 });
    }
    const productObservations = [];
    const freezeBinding = { implementationSha256, catalogSha256: catalogHash, runtimeConfigurationSha256: runtimeSha256, configurationSha256: canonicalHash({ phase: options.phase, seed: options.seed, effort: options.effort, repeats: REPEATS, candidatePolicy: options.candidatePolicy, algorithms: options.algorithms, runtimeConfigurationSha256: runtimeSha256 }), profilesSha256: canonicalHash(input), registrationSha256: options.registrationSha256 ?? null, challengeManifestSha256: registration?.config.challengeManifestSha256 ?? null, sourceSnapshotSha256: registration?.config.sourceSnapshotSha256 ?? null };
    const write = (name, value) => writeFile(path.join(output, name), safeSerialize(value));
    const bindingFile = path.join(output, "batch-binding.json");
    if (batch) {
      if (options.resume) {
        const previous = JSON.parse(await readFile(bindingFile, "utf8"));
        if (canonicalHash(previous) !== canonicalHash(freezeBinding)) throw new Error("batch_freeze_changed");
      } else {
        await writeFile(bindingFile, safeSerialize(freezeBinding), { flag: "wx", mode: 0o600 });
      }
    }
    await write("implementation-snapshot.json", {sha256:implementationSha256,files:implementation});
    await write("runtime-configuration.json", {sha256:runtimeSha256,configuration:runtime});
    await write("catalog-snapshot.json", { catalogVersion, sha256: catalogHash, records });
    await write("profiles-snapshot.json", input);
    await write("contexts.json", { catalogVersion, asOf: input.asOf, profiles: snapshots.map((context, index) => ({ profileId: input.profiles[index].profileId, sha256: contextHashes[index], context })) });
    const gates = Object.fromEntries(Object.keys(METHODS).map(algorithm => [algorithm, algorithmGate(algorithm, options)]));
    if (registration && options.live && (process.env.AI_SPEND_PHASE !== "formal" || !process.env.AI_SPEND_RUN_ID || !Number.isFinite(Number(process.env.AI_SPEND_FUNDED_CNY)))) throw new Error("formal_spend_authority_required");
    if (gates.B.allowed || gates.C.allowed && options.candidatePolicy === "hybrid60") {
      try { const { createLocalE5 } = await import("./local-e5.mjs"); embeddingProvider = await createLocalE5({ cacheDir: options.e5Cache }); }
      catch { gates.B = { allowed: false, reason: "local_pinned_e5_unavailable_prepare_cache_first" }; if (options.candidatePolicy === "hybrid60") gates.C = { allowed: false, reason: "local_pinned_e5_unavailable_prepare_cache_first" }; }
    }
    if (embeddingProvider) await write("embedding-assets.json", embeddingProvider.verifiedAssets);
    if (batch && options.algorithms.some(algorithm => !gates[algorithm].allowed)) throw new Error("registered_arm_unavailable");
    const spendScope = batch ? await server.ssrLoadModule("/src/lib/ai/spend-run-context.ts") : null;
    const rankings = { schemaVersion: "saitu.ranking-evaluation.v1", purpose: registration ? "ai_proxy_acceptance" : "development", catalogVersion,
      algorithms: options.algorithms, expectedRunsPerProfile: REPEATS,
      profiles: input.profiles.map((item, index) => ({ profileId: item.profileId, familyId: item.familyId, taskGroup: item.taskGroup,
        poolItemIds: contexts[index].candidates.map(candidate => candidate.record.recordId),
        judgments: contexts[index].candidates.map(candidate => ({ itemId: candidate.record.recordId, seriesId: candidate.record.seriesId, relevance: "U" })),
        annotationStatus: "pending" })), runs: [] };
    const manifest = { schemaVersion: "saitu.experiment-run.v2", startedAt, completedAt: null, asOf: input.asOf,
      purpose: registration ? "ai_proxy_acceptance" : "development", phase: options.phase, seed: options.seed, reasoningEffort: options.effort, thinking: "enabled",
      candidatePolicy: options.candidatePolicy, comparisonLabel: options.phase === "E2" ? "same_candidate_ranking" : options.candidatePolicy === "full" ? "C_full" : "C_retrieval_hybrid60",
      profilesSha256: canonicalHash(input), contextsSha256: digest(snapshots), implementationSha256,
      embeddingAssetLockSha256: embeddingProvider?.verifiedAssets.assetLockSha256 ?? null,
      origin: input.origin, profileCount: input.profiles.length, catalogVersion, catalogSha256: catalogHash,
      requestedAlgorithms: options.algorithms, expectedRunsPerProfile: REPEATS, liveRequested: options.live,
      algorithms: Object.entries(METHODS).map(([algorithm, method]) => ({ algorithm, method, requested: options.algorithms.includes(algorithm),
        status: gates[algorithm].allowed ? "running" : "not_run", reason: gates[algorithm].reason,
        expectedRuns: options.algorithms.includes(algorithm) ? input.profiles.length * REPEATS : 0, completedRuns: 0, failedRuns: 0 })),
      runs: [], costCny: null, costStatus: "not_estimated_no_pricing_snapshot_or_verified_cache_usage",
      metricStatus: "pending_candidate_judgments", independentAcceptanceEligible: false,
      limitations: ["Synthetic profiles and repeated generations are not independent student samples.",
        "All frozen-pool judgments start as U/pending. No relevance labels are inferred from algorithm output.",
        "Reports contain actual user-visible results. Stage observations preserve returned pre-validation candidates when available; absent model output is never reconstructed.",
        "Costs are copied only from measured trace; missing pricing or usage remains unknown."] };
    await write("experiment.json", manifest);
    let newRuns = 0, paused = false, insufficientFunds = false;
    const unresolvedIntents = [], deferredSlots = [];
    for (let profileIndex = 0; profileIndex < input.profiles.length; profileIndex++) {
      const item = input.profiles[profileIndex], context = contexts[profileIndex];
      for (let repetition = 1; repetition <= REPEATS; repetition++) {
        for (const algorithm of options.algorithms) {
          if (!gates[algorithm].allowed) continue;
          const runId = `${algorithm}-${String(profileIndex + 1).padStart(3, "0")}-${String(repetition).padStart(2, "0")}`;
          const method = METHODS[algorithm];
          let stageCount = 0;
          const rankingInput = item.input ?? {profile: item.profile};
          const invoke = (invocationId, permit) => {
            const work = () => executeFrozenRanking({algorithm,profile:item.profile,context,input:rankingInput,caseId:item.caseId??item.profileId,profileId:item.profileId,familyId:item.familyId,taskGroup:item.taskGroup,repetition,seed:options.seed,effort:options.effort,freezeBinding,
              modules:{engine,model,hybrid,validation,productObservation},embeddingProvider,invocationId,
              onAccountingEvent: batch && algorithm === "C" ? event => {
                if (!["ai_budget_reserved","ai_transport_dispatch","ai_budget_settled","ai_settlement_failed","ai_budget_denied"].includes(event.type)) return;
                const {reservationId,reservedMicros,chargedMicros,operation} = event.details;
                appendFileSync(path.join(output,"checkpoints",runId+".accounting.jsonl"),
                  JSON.stringify({invocationId,type:event.type,reservationId,reservedMicros,chargedMicros,operation,time:event.time})+"\n",
                  {mode:0o600,flush:true});
              } : undefined,
              onStage: batch ? undefined : async event => { await write(`stages/${runId}-${String((stageCount++)+1).padStart(2,"0")}.json`,event); }});
            return batch && algorithm === "C" ? spendScope.withAiSpendLimit(permit.ceiling, work) : work();
          };
          let result;
          if (batch) {
            const step = await checkpointedRanking({directory:path.join(output, "checkpoints"),slot:runId,input:rankingInput,
              algorithm,repetition,freezeBinding,profileId:item.profileId,caseId:item.caseId,
              canStart:async () => {
                if (newRuns >= batch.runsPerBatch) return null;
                if (algorithm !== "C") return {};
                if (options.deferC || insufficientFunds) return null;
                const ceiling = await ledger.ceilingForNextRun(batch.maxCReservationMicros);
                if (ceiling === null) insufficientFunds = true;
                return ceiling === null ? null : {ceiling};
              },execute:invoke});
            if (step.status === "paused") {
              paused = true;
              const reason = newRuns >= batch.runsPerBatch ? "batch_run_limit" :
                options.deferC ? "c_explicitly_deferred" : "c_reservation_not_affordable";
              deferredSlots.push({runId,algorithm,reason});
              // Continue over the original slot order: free arms and existing
              // receipts still count even when one paid slot cannot start.
              continue;
            }
            if (step.status === "indeterminate") { unresolvedIntents.push({runId,invocationId:step.claim.invocationId}); continue; }
            if (step.status === "executed") newRuns++;
            result = step.result;
            for (const event of result.stages) await write(`stages/${runId}-${String(++stageCount).padStart(2,"0")}.json`, event);
          } else {
            result = await invoke();
          }
          const {report,errorCode,shuffleSeed,candidateOrder,retrieval,stages:observations} = result;
          productObservations.push(result.observation);
          await write(`observations/${runId}.json`,result.observation);
          if (canonicalHash(records) !== catalogHash || digest(frozenContextSnapshot(context)) !== contextHashes[profileIndex]) throw new Error("frozen_experiment_context_changed");
          const run = { algorithm, requestedMethod: method, profileId: item.profileId, familyId: item.familyId, taskGroup: item.taskGroup,
            runId, repetition, status: report ? "completed" : "failed", errorCode,
            actualMethod: report?.trace.method ?? null, actualModel: report?.trace.model ?? null,
            modelStatus: report ? generationStatus(report, algorithm === "B" ? "hybrid" : method) : "validation_failed",
            fallbackUsed: report?.fallback.used ?? false, fallbackReason: report?.fallback.reason ?? null,
            elapsedMs: result.elapsedMs, traceElapsedMs: report?.trace.elapsedMs ?? null,
            callCount: report?.trace.callCount ?? null, inputTokens: report?.trace.inputTokens ?? null, outputTokens: report?.trace.outputTokens ?? null,
            cachedInputTokens: report?.trace.cachedInputTokens ?? null, costCny: report?.trace.costCny ?? null,
            costStatus: report?.trace.costStatus ?? (algorithm === "B" || algorithm === "A1" ? "no_paid_model_calls" : "unknown_usage_or_price"),
            priceVersion: report?.trace.priceVersion ?? null,
            requestedEffort: options.effort, actualEffort: report?.trace.reasoningEffort ?? null, thinking: report?.trace.thinking ?? null,
            calls: report?.trace.calls ?? [], shuffleSeed, candidateOrder, candidateSetSha256: digest([...candidateOrder].sort()), skipIndependentRecall: true, retrieval,
            displayedItemIds: report?.recommendations.map(recommendation => recommendation.itemId) ?? [],
            rawItemIdsStatus: observations.some(event=>event.stage==="match"&&event.data?.output) ? "recorded_in_stage_observations" : "not_observed",
            observationFiles: observations.map((_event,index)=>`stages/${runId}-${String(index+1).padStart(2,"0")}.json`),
            contextSha256: contextHashes[profileIndex], catalogSha256: catalogHash,
            reportFile: `runs/${runId}.json`, evaluationObservationFile: `observations/${runId}.json`,
            invocationId: result.observation.invocationId, inputSha256: result.observation.inputSha256, outputSha256: result.observation.outputSha256, reservationIds: result.observation.reservationIds, execution: result.observation.execution };
          await write(run.reportFile, { ...run, report });
          manifest.runs.push(run);
          rankings.runs.push(result.ranking);
          const summary = manifest.algorithms.find(entry => entry.algorithm === algorithm);
          if (report) summary.completedRuns++; else summary.failedRuns++;
          await write("experiment.json", manifest);
        }
      }
      console.log(JSON.stringify({ profile: profileIndex + 1, totalProfiles: input.profiles.length, completedRuns: manifest.runs.length }));
    }
    if (batch && (paused || unresolvedIntents.length)) {
      if (canonicalHash(await sourceManifest(root)) !== implementationSha256 || runtimeConfigurationHash() !== runtimeSha256) {
        throw new Error("batch_source_or_runtime_changed_during_execution");
      }
      const progress = {status: "partial", expectedRuns: 1800, completedRuns: manifest.runs.length,
        newRuns, unresolvedIntents, deferredSlots, registrationSha256: options.registrationSha256, acceptanceGranted:false};
      await write("batch-progress.json", progress);
      return {output, exitCode: 2, ...progress};
    }
    for (const summary of manifest.algorithms) if (gates[summary.algorithm].allowed) summary.status = summary.failedRuns ? "completed_with_failures" : "completed";
    manifest.completedAt = new Date().toISOString();
    manifest.executionCounts = summarizeBoundRuns(productObservations);
    await write("product-observations.json", {schemaVersion:"saitu.bound-ranking-observations.v1",freezeBinding,observations:productObservations});
    manifest.implementationUnchanged = canonicalHash(await sourceManifest(root)) === implementationSha256;
    manifest.runtimeConfigurationUnchanged = runtimeConfigurationHash() === runtimeSha256;
    if (!manifest.runtimeConfigurationUnchanged) { await write("experiment.json", manifest); throw new Error("runtime_configuration_changed_during_experiment"); }
    if (!manifest.implementationUnchanged) { await write("experiment.json", manifest); throw new Error("implementation_changed_during_experiment"); }
    manifest.costCny = manifest.runs.every(run => run.costCny !== null || run.callCount === 0) ? manifest.runs.reduce((sum, run) => sum + (run.costCny ?? 0), 0) : null;
    manifest.costStatus = manifest.costCny === null ? "unpriced_calls_present" : "usage_upper_bound_sum_not_invoice";
    await write("ranking-input.json", rankings);
    await write("ranking-results.json", evaluation.evaluateRankings(rankings));
    await write("experiment.json", manifest);
    await write("freeze-manifest.json", { schemaVersion: "saitu.experiment-freeze.v1", frozenAt: startedAt, phase: options.phase, seed: options.seed, freezeBinding,
      requestedAlgorithms: options.algorithms, configuration: { effort: options.effort, repeats: REPEATS, candidatePolicy: options.candidatePolicy, skipIndependentRecall: true },
      files: await Promise.all([...(registration ? ["opening.json","registration.json"] : []),
        ...(batch ? ["batch-binding.json", ...manifest.runs.flatMap(run => [`checkpoints/${run.runId}.claim.json`,`checkpoints/${run.runId}.result.json`])] : []), "implementation-snapshot.json", "runtime-configuration.json", "catalog-snapshot.json", "profiles-snapshot.json", "contexts.json", "ranking-input.json", "ranking-results.json", "product-observations.json", "experiment.json", ...manifest.runs.flatMap(run => [run.reportFile,run.evaluationObservationFile,...run.observationFiles])].map(async name =>
        ({ path: name, sha256: createHash("sha256").update(await readFile(path.join(output, name))).digest("hex") }))) });
    if (batch) await write("batch-progress.json", {status:"matrix_collected",expectedRuns:1800,completedRuns:manifest.runs.length,newRuns,unresolvedIntents:[],acceptanceGranted:false});
    const exitCode = manifest.runs.some(run => run.status === "failed") ? 1
      : manifest.algorithms.some(entry => entry.requested && entry.status === "not_run") ? 2 : 0;
    return { output, exitCode, profileCount: input.profiles.length, actualRunCount: manifest.runs.length,
      algorithms: manifest.algorithms, metricStatus: manifest.metricStatus, costCny: manifest.costCny };
  } finally { if (embeddingProvider) await embeddingProvider.dispose(); await server.close(); }
}

async function main() {
  try {
    const { default: nextEnv } = await import("@next/env");
    nextEnv.loadEnvConfig(root);
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log("Usage: run-experiment.mjs --input PROFILES.json [--output NEW_DIRECTORY] [--algorithms A0,A1,B,C] [--phase E2|E3] [--candidate-policy full|hybrid60] [--seed 6141] [--effort max|high|low] [--e5-cache DIRECTORY] [--live]\nPreregister batchPolicy to bound each invocation tranche; use --open --resume with the same registration/output to continue. --defer-c keeps paid slots unexecuted while progressing free arms.\nA0 requires a historical snapshot adapter; A1 is the fair current rule baseline; B is local BM25+E5+RRF; C is real Flash. Five seeded input permutations. E2 disables independent recall. Default A1 only; paid C requires explicit --live and server configuration. No silent effort downgrade.");
      return;
    }
    const summary = await executeExperiment(options);
    console.log(safeSerialize(summary).trim());
    process.exitCode = summary.exitCode;
  } catch (error) {
    const known = error instanceof Error && /^[a-zA-Z0-9_:,]+$/.test(error.message) ? error.message : "experiment_failed_check_input_and_configuration";
    console.error(JSON.stringify({ status: "failed", reason: known }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
