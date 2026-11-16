# Sealed product runner (public implementation contract)

`run-sealed-product.mjs` executes product functions and records observations. It does not score answers, read answer keys, claim human review, or label an algorithm winner. Development used public schemas and synthetic fixtures only. The 800 private cases have not been opened by this implementation owner.

## Entry points

- `invokeEvaluationProduct` in `src/lib/competitions/v6/evaluation-adapter.ts` is the six-operation adapter. It validates the exact canonical input SHA-256 and uses `extractProfileFacts`, `observeProfileConversation`, `qualifySourceCondition`, `judgeSourceClaims`, and `runDecisionRecommendation`. `recommend` receives the intact canonical profile in its context; its V5 view is only a compatibility projection. A confirmed supported stage is required; no stage is guessed.
- `runEvaluationChatSteps` calls the real `POST /api/ai/competition-chat` handler, real encrypted PostgreSQL state/CAS, and the same `acceptDecisionChatResponse` function used by `DecisionChat.tsx`. It does not fabricate proposal IDs or signed tokens. The initialization fixture explicitly confirms undergraduate year 2, uses a fresh profile identity, then proposes and confirms the supplied goal through the product.
- `importEvaluationSourceRegistry` copies only explicitly supplied raw/body artifacts, checks both hashes, requires an exact catalog alias or an explicitly frozen authoritative identity, and binds the resulting server registry by SHA-256. It does not promote a source into a recommendation-catalog eligibility fact. Identity approval and factual review remain separate. Missing/ambiguous aliases are recorded as blocked; body hashes cannot supply authority by themselves.
- `withEvaluationSourceMutation` creates a temporary independent registry, copies verified source bytes, changes the actual loader input and restores the fixture afterward. Conflicts retain the original body and hash plus an explicitly synthetic conflicting version and hash. An empty mutation is rejected.
- `withProductObservation` records metadata only using AsyncLocalStorage. Observer exceptions are swallowed; they cannot initiate a retry or reverse a paid settlement/CAS. Raw prompts, credentials and model reasoning are excluded. Provider request IDs retain the client's anonymization. Hooks are internal server contexts and cannot be supplied by HTTP callers.

## Supported and unsupported observations

Supported: seven actual text transformations; four actual source-registry mutations; duplicate exact requests, stale revision, a separately initialized profile token, strict unconfirmed side-channel fields, cancellation at the real pre-CAS hook, concurrent commits, and genuine other-response replay through browser consumption. Events separate injected actions from actual product observations; state snapshots are real PG reads. Missing models/PG/registry are `not_run`, never simulated success.

`catalog_version_binding` now uses the real `catalog-runtime.ts` loader and an atomically replaced temporary active snapshot. Its records preserve an existing structurally valid L1 discovery; only version metadata changes. No review approvals are fabricated. The authenticated route checks the loaded catalog before idempotency replay and again at CAS; old versions return 409 without mutation. The recommendation edit path also rejects a stale directory.

Transport timeout/abort/Retry-After faults run inside a request-scoped wrapper of the actual shared fetch boundary. Outside that scope fetch is a passthrough. `budget_denied` lowers the effective cap to one micro-CNY in a server-only AsyncLocalStorage scope. It uses the existing administrator-bound authority/run and real PG reservation path; it cannot create/select another run, write authority or increase any cap. Isolated integration tests initialize their own disposable database authority administratively. An unexpected transport path is blocked in this fixture. Before-dispatch injected failures have zero real network dispatches, although the product may conservatively retain a reservation: that ledger hold is not a provider invoice. After-dispatch response loss has unknown provider usage/cost, never invented zero usage. These facts are recorded separately.

A concrete unsupported/malformed fixture still reports its real boundary limitation. Two distinct pending proposals cannot both be fabricated against this product's one-proposal state: an inapplicable parallel fixture is `not_run` with the partial observed trace retained. The shared-proposal race is exercised through actual CAS.

The CLI supports preregistered `rules` (A1) and `llm` (C), with frozen full-catalog candidate identities and repeated recommendation calls. A0 historical and B local embedding comparison remain in the separate experiment harness; this CLI must not be described as running all four algorithms. Ranking labels remain pending independent full-pool review.

## Opening protocol

1. Prepare a public config JSON:

```json
{"schemaVersion":"saitu.sealed-run-config.v1","asOf":"2026-11-05T00:00:00Z","modelMode":"disabled","method":"rules","seed":6141,"repeats":5,"inputSha256":"<exact JSONL byte hash>"}
```

For source cases add `sources: {indexSha256, identitiesSha256?}`. The optional identities file is an independently frozen array of `{sourceId,seriesId,scope,url,authority,editionId,historical}`. It is administrative evidence identity, never a client source packet. Catalog aliases must match exact URL/scope/source/series identity. A source with neither exact alias nor approved identity is blocked.

In this evaluation registry, `historical: true` means the binding does not assert a verified-current rule: use the frozen document only within its explicit `editionId` and `scope`. It does not by itself mean that the document was false, has expired, or cannot answer a question about that frozen edition. Catalog-derived bindings set it to true when none of the source's associated facts is `verified_current`; that includes unresolved current applicability, not only an old calendar year. An explicit administrative identity must preserve this conservative boundary. `historical: false` needs separate evidence of current applicability, and neither value proves an open registration window or overall student eligibility. Condition judgments still require the actual document, the requested scope and confirmed student facts; this metadata is not an answer label.

2. Register before opening:

```sh
node scripts/competitions/v6/run-sealed-product.mjs register --config public-config.json --output registration.json
```

This freezes source file hashes, catalog hash, capability list, method/repeats/seed and the input hash; it does not open the inputs. Retain the returned registration SHA-256.

3. At authorized opening:

```sh
node scripts/competitions/v6/run-sealed-product.mjs run \
  --registration registration.json --registration-sha256 <sha> \
  --input <explicit opened cases JSONL> --output <new isolated directory> --open
```

For sources add `--source-root <source-index directory> --source-index source-index.json`, and `--identities <approved identity manifest>` when preregistered. For paid execution, config must say `modelMode: live` and command must include `--live`; real DeepSeek configuration and an existing formal spend run are required. The runner does not fund, expand or replace the budget. It loads local environment without printing/copying secrets. Do not use production DB: use the approved isolated local validation DB.

The runner records an opening receipt before reading case bytes; verifies registration/source/input/catalog bindings; freezes a randomized execution order; fsyncs each observation JSONL row; saves the exact catalog; and records final counts and observation hash. It does not turn `observed` into `passed`. No family/template metadata is forwarded to the model. Vite dependency discovery is disabled so archived HTML source scripts are not executed.

Changes after registration intentionally block execution and require a new reviewed registration. `modelMode: disabled` does not invoke any model, including otherwise deterministic chat paths. Missing usage is null; local injected responses must never be represented as provider usage.

## Verification to date

42 targeted and regression checks passed across 7 files, including 6 new real PostgreSQL chat/CAS/catalog/browser-binding scenarios, 3 existing PostgreSQL state scenarios, 2 PostgreSQL observer/budget scenarios, 3 runtime snapshot scenarios, and 28 adapter/chat/transport checks. The provider transport was synthetic; none called paid APIs. A synthetic disabled-mode CLI registration/opening completed with `0 observed, 0 error, 1 not_run`, as required for an unauthorized model invocation. Its artifacts are under `artifacts/v6/product-runner-smoke-20261105/`; they are not sealed-case results.

Commands:

```sh
RUN_DECISION_STATE_INTEGRATION=1 RUN_SPEND_LEDGER_POSTGRES_TESTS=1 node node_modules/vitest/vitest.mjs run tests/ai/product-observation.test.ts tests/ai/product-observation-postgres.integration.test.ts tests/competitions/v6/evaluation-chat-postgres.integration.test.ts tests/competitions/v6/product-evaluation-adapter.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

On this host use `/Users/jiumian/Library/Application Support/Codex/artifact-sessions/runtime-generations/generation-vSQd0h/runtime/bin/node` rather than the incompatible ChatGPT bundled Node binary. PG integration fixtures expire their own decision states; spend fixtures intentionally remain in the audit ledger with synthetic operation names and no provider invocation.

## Reuse the selected 600 ranking invocations

The recommendation branch now uses `frozen-ranking-executor.mjs`, shared with the E2 A1/B/C experiment. Standalone `rules`/`llm` calls use the same five seeded permutations and full-pool contract. B is executed in the matrix, then may be selected here as `method:"hybrid"` only with reuse. Other operations still use the existing six-operation product adapter; their execution coverage must not be described as all using an HTTP route.

After the complete matrix and independent algorithm selection, register the 800-case product configuration with:

```json
{"rankingReuse":{"algorithm":"C","freezeManifestSha256":"<exact matrix freeze-manifest bytes SHA>"},"challengeManifestSha256":"<same challenge manifest SHA>","sourceSnapshotSha256":"<same source snapshot SHA>"}
```

These are additions to the existing config; `method`, `asOf`, `seed`, and five repeats must match. At run time add `--ranking-run <matrix output directory>`. All listed artifact byte hashes, implementation/catalog/challenge/source binding, configuration, input/output canonical hashes, invocation IDs and reservation IDs are checked. Before executing any other case, all 120×5 exact matches must resolve. Missing/changed entries block; they never cause a paid regeneration. The original invocation ID and output are copied, with `reusedFromFreezeSha256` indicating the transport copy. The final summary distinguishes 600 reused ranking observations from zero newly executed ranking calls.

The matrix freeze is immutable: independently reviewed labels are merged into a new scoring bundle, never written over the original U/pending artifact. Registration/reuse verification is artifact validation, not proof that labels, reviews or production readiness passed.
