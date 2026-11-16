# v7 decision worker operations

`pnpm build` now invokes `scripts/competitions/v7/build-worker.mjs` for one
worker/Next build. The builder derives the source binding from the actual
reviewed files, ignores a caller-supplied source hash, bundles the worker, passes
the same hash to Next, and rejects source changes during the build. Do not run
`next build` directly for a release. `dist/decision-worker/manifest.json` binds
the worker bytes, source SHA-256, Next BUILD_ID and the Next binding receipt.
The verifier also checks the source value captured in Next's compiled config.
The signed Linux evidence generation now includes `worker-build-result.json`;
deployment requires its source/worker hashes to match the rebuilt candidate.

Each supported PM2 slot has `resume-ai-3000` / `resume-ai-worker-3000` or the
equivalent `3001` pair. The default worker concurrency is two (allowed range
one through four). The root-owned application file may set
`SAITU_V7_WORKER_CONCURRENCY`, but cannot set a source hash, health path, active
link, release path, proxy or trust override. Next and worker receive their
physical `APP_RELEASE_DIR` and immutable source binding from the build. Legacy
releases without a v7 worker source marker remain supported by the new topology
verifier.

Both Next's later chat stages and the worker check the same active-release
gate. A candidate can reach PostgreSQL and publish a fresh `paused` heartbeat
while `/opt/resume-ai/current` still identifies the old release. It cannot claim
or dispatch paid stages. Switching the root-owned current symlink enables the
matching release and prevents later stages from the other slot. Already
dispatched responses may complete and settle their original ledger receipts.
The cutover does not abort their HTTP signals. Unknown dispatch outcomes keep
their original reservations; operators must not retry them as a new paid call.

The health record lives at
`/var/cache/resume-ai/RELEASE_ID/decision-worker-health.json`, mode `0600`.
It carries PID, source hash, slot status, database readiness, concurrency,
in-flight count and timestamp. It contains no personal content or credentials.
Deployment requires a matching live PM2 PID and a fresh paused heartbeat before
traffic switching. Release consistency requires fresh active/paused records for
the selected topology. Boot topology validates both executable bytes and the
Next/worker binding before PM2 resurrection.

For a v7-to-legacy rollback, current is switched first. The rollback/recovery
writer then waits for the exact previous v7 worker to publish `paused` with zero
in-flight work before deleting only that named worker and persisting PM2. A
missing/old/mismatched heartbeat or a drain lasting more than 105 seconds fails
the rollback verification and retains the worker. It never expands the PM2
deletion scope or force-kills an unverified paid request. The complete old
control-generation/environment transition still requires the Linux release
gate; the local drain test alone is not that acceptance.

Database migrations remain byte-pinned in `ops/config/migrations.manifest` and
the reviewed migration validator. Runs, calls and chat requests grant runtime
only SELECT/INSERT/UPDATE; DDL, DELETE and TRUNCATE stay unavailable. The
maintenance upgrade accepts an exact prior v6 role, saves its actual ACLs for
rollback, then adds only the new retention grants. Retention deletes expired
chat requests, calls, runs and states in that order, respecting foreign keys and
bounded committed batches. Spend budgets, authority, grant conditions and the
ledger are retained. Backup restore's required-table list and fixed read-only
catalog gate cover the new tables, encrypted columns, constraints, indexes,
foreign keys and complete legacy/v7 grant predicate.

Local checks use the fixed Node executable from the session; they neither call
the provider nor deploy production:

```sh
node tests/deployment/v7-ops-postgres.test.mjs
node node_modules/vitest/vitest.mjs run tests/deployment/v7-worker-ops.test.ts tests/deployment/reviewed-migration-routing.test.ts tests/security/security-state-cleanup.test.ts
node ops/bin/verify-decision-worker-build.mjs /absolute/release
node ops/bin/verify-decision-worker-health.mjs /absolute/release active --pid PM2_PID
```

The PostgreSQL integration script creates its own socket-only PostgreSQL 17
server and random databases/roles, executes the unchanged production catalog
SQL in read-only mode, checks destructive schema mutants, exercises both
cleanup implementations and runs the built worker against a separate empty
local test database. It drops only its own databases/roles and stops only its
own server. The actual local test artifact is evidence of those cases, not a
production PostgreSQL 14 restore, performance result or paid-model success.

The outer Lima guest `saitu-validation` is Ubuntu 24.04.5/aarch64 with Node
24.20.0 arm64. It was reused only under a new `/tmp/saitu-v7-operations-*`
directory for portable Bash/Python/Node syntax and worker-artifact verification.
No existing guest service was stopped. Its already running QEMU guest
`saitu-validation-x64` is actual Ubuntu 22.04.5/Jammy amd64 with Node 24.20.0 x64,
pnpm 11.19.0, PM2 7.0.4, PostgreSQL 14.24 and systemd 249. The existing Ed25519
signing keypair was checked only for presence and exact root ownership/modes;
its private bytes were not exported. A new
`/root/saitu-v7-ops-20261109-pre-freeze` directory retains the local snapshot.
The native PG14 read-only/negative-schema and cleanup/cross-database/owner-ACL
dump-restore/bounded-lock regressions passed against self-created disposable
clusters. These are setup/snapshot observations. Formal Ed25519 candidate
signing, production-shaped complete switch/rollback, the release's full backup
restore, a final reviewed source freeze and the 30-minute soak remain pending
until their actual gates run. The formal coordinator continues to reject the
outer ARM/Noble guest and requires the immutable x64 toolchain in the inner
Jammy guest.
After the final reviewed source changes, regenerate and check the bootstrap
manifest with the runbook's real generator; do not substitute expected hashes
to silence a mismatch.

## Stage effort release contract

New source containing `src/lib/ai/effort-policy.mjs` requires an explicit
`saitu.v7.effort.v1` grant with `authorized_effort=stage`. Its policy is exactly
`{version:"saitu.effort-policy.v1",rank,explain,review}` with each stage `high` or
`low`. Normalization, extraction and chat retain `high`. The separate authorization
original is `docs/v7/effort-continuation-contract-20261109.md`; neither an old
`saitu.v7` high grant nor a legacy max grant authorizes the new stage map.

The protected application environment carries `SAITU_V7_EFFORT_POLICY`, its
`SAITU_V7_EFFORT_POLICY_SHA256`, `AI_SPEND_AUTHORIZED_EFFORT=stage` and
`AI_SPEND_EFFORT_CONDITION_SHA256`. Keep the old high-condition field empty and
`AI_REASONING_EFFORT=high` for the fixed-high operations. New run IDs use
`saitu-v7-effort-20261109-PHASE-NN`. The shared authority, fresh funded checkpoint,
finite batch count and administrator budget remain mandatory; no lab database
copy can substitute for the common ledger.

The unified builder freezes the canonical stage map and its fingerprint into
both the worker and Next. Their manifests, compiled configuration, installed
runtime and PM2 application environment must agree. A different stage map changes
the runtime binding. An old worker manifest is accepted only on the legacy path;
new source cannot silently acquire an all-high default at release verification.
The production browser gate receives the source binding only from this run's
verified worker receipt, along with that same frozen effort environment.

The fixed release verifier uses a new `v7-effort` profile and versioned permit,
receipt and verifier identity. It still has exactly two paid request slots:
normalization at high and the fixed recommendation at `policy.rank`. Claim and
settlement retain the original immutable policy fingerprint. Unknown dispatches
remain fully reserved, and an already incurred cost may settle after grant close.
The old max/high permit and receipt branches keep their original meanings.

Native evidence v2 retains the original thirteen observations and adds the actual
stage-grant application/PM2/reserve path as observation fourteen. It must bind the
same worker policy fingerprint. The release registry currently requires300 exact
observations: the retained218, sixty stage-effort protections, nine source
provenance/visible-condition protections, three compiled-policy protections and
ten lossless rank/generation/review-boundary protections.
Test collection and isolated
PG17 checks are preparation evidence; the complete pinned Linux PG14 command,
uniform production build, signatures, installed delivery, switch/rollback/restore
and actual1800-second soak remain distinct final gates. No conditionally skipped
required observation is a pass.

## Top5 continuation

The Top5 policy is `saitu.policy.2026-11-09.v7.top5`, with new task implementation
`saitu.async.2026-11-09.v7.3.top5`. New jobs freeze at most five distinct series,
40-second list and 120-second all-detail targets, and original 60/150-second hard
cutoffs. Existing task bodies keep their original persisted policy and deadlines.
The default stage map is low/low/low; profile, normalization and chat remain high,
and thinking stays enabled for every stage.

The separate `saitu.v7.top5.v1` grant binds the original bytes of
`docs/v7/top5-continuation-contract-20261109.md`, the exact Top5 policy and
implementation versions, a prior-ledger hash, and the low/low/low fingerprint.
Its run namespace is `saitu-v7-top5-20261109-PHASE-NN`. The fixed release profile
is `v7-top5`, with separate v7.top5.v1 spend policy, permit, receipt and verifier
identities. It still reserves exactly two original requests: normalization high
and recommendation low. Unknowns remain held; closure does not block settlement.
Use `ops/config/ai-spend-ledger.v7-top5.example.json` only as a private provisioning
template; populated configuration must never enter the source tree.

Apply the new `20261109_spend_v7_top5_policy.sql` after the unchanged historical
migrations. Existing installed migrations must not be replayed: the named
`ai_spend_top5_grant_check` marker lets the administrator installer identify an
already upgraded database. The read-only SQL requires both the complete expanded
grant predicate and that validated marker. The native v3 receipt retains the
original fourteen observations and adds the actual Top5 application/PM2/reserve
chain, including the missing-marker negative check. Historical v1/v2 evidence
retains its original interpretation.

The 300-observation/68-pin checkpoint precedes the Top5 source. Final registry
migrations and source/bootstrap pins are derived once after all owners declare
stable source. Prior passing observations cannot prove that final generation.
The prepared x64 lab has Node24.20.0/npm11.19.0/PM2 7.0.4/pnpm11.19.0 and PG14.24;
application controls, signing adoption, final all-required Linux execution,
signed installed candidates, switch/rollback/restore and real1800-second soak
must each be recorded against the final generation. Do not rerun the old
empty-target lab apply or runtime installer over the prepared environment.

## Explicit user-unbounded execution

The current execution authorization is
`docs/v7/top5-unbounded-execution-contract-20261109.md`. It retains the Top5
business policy, LLL stages, enabled thinking, product timeouts, request identity
and unknown-result protection. Historical finite grants and receipts retain
their original meanings.

Set `SAITU_AI_EXECUTION_MODE=user-unbounded` in the protected build and runtime
environments. The new grant is `saitu.v7.top5.user-unbounded.v1`, and runs use
`saitu-v7-top5-unbounded-20261109-PHASE-NN`. Both budget `hard_limit_micros` and
batch `call_limit` are NULL only with that explicit execution mode. The frozen
condition records `executionMode` and three null `executionLimits` fields. Old
numeric concurrency, queue, daily-call, calibration-count and spend-cap
environment values do not cap this mode. Scheduling follows actual resource
and provider feedback; input/output limits and existing repair rules remain.

Apply only the new forward migration
`20261109_spend_user_unbounded_execution.sql` to an installed Top5 database;
never replay old migrations. Its cross checks preserve finite rows and permit
nullable caps only in the new branch. The read-only schema verifier matches the
actual PG14 expressions and requires the three execution-mode columns. A fresh
disposable database applies historical migrations once in order, then both new
forward migrations.

Use `ops/config/ai-spend-ledger.v7-top5.user-unbounded.example.json` as the
protected provisioning template. Its numeric `fundedCny` and
`funding.fundingLimitMicros` placeholders must both be replaced from the latest
physical funding checkpoint, including prior unknown holds. They are real
available funds, not an artificial experiment allowance. New permit, receipt
and verifier identities use `v7.top5.user-unbounded.v1`; their artificial limit
and call count are null. The fixed smoke method still sends its two distinct
normalization/recommendation requests once; this method shape is not a batch
limit. Unknown requests remain held and are never resubmitted as a consequence
of unbounded authorization. No automatic recharge is authorized.

The uniform Next/worker build, compiled environment, source/build freezes,
PM2 app environment and worker health all bind `executionMode=user-unbounded`.
Worker health reports `concurrency:null`; a finite build or manifest cannot
substitute. Native receipt v4 preserves the first fifteen observations and adds
an actual three-reservation new-grant path plus physical-unknown-hold rejection,
using a disposable PG14 database and zero provider dispatches. Original v1-v3
receipts remain readable for their unchanged historical source branches.

The earlier bounded Top5 source freeze and completed local build are retained as
superseded evidence. Generate the new source/registry pins once owners declare
all new bytes stable; then build and bind the real artifacts. Local Node24.22
builds are preparation evidence. Pinned Linux Node24.20/PG14 execution, signatures,
installed candidate, switch/rollback/restore and actual1800-second soak must each
be recorded on the final new generation before claiming their completion.
