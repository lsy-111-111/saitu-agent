# Unified V6 candidate consumption (U)

This is a candidate acceptance path, not a deployment command. No production
registration, provider call, 800-case run, signing key installation or deployment
is performed by its development tests. Actual `TRUSTED_CANDIDATE_BINDINGS` and K's
actual registration remain empty, so current actual inputs remain pending.

## Trust and launch

The independent controller reviews and freezes the complete U package listed by
`U_MEMBERS` in `final-candidate-binding.mjs` (eight files, including an unchanged
separate three-file K and the unchanged engineering verifier). U's own three
imports use relative `.mjs` paths and Node builtins only. It has no ambient npm
loader, plugin, callback, entrypoint, signature-key override or approval flag.
K retains its separately checked V loader/package closure. No K source changes
are required in product candidate C, and C still contains all acceptance scripts,
ops and configuration. C, V, K and U may have different source identities.

The accepted trust boundary is a reviewed-controller launch on a shared
filesystem. It is **not** isolation against a root process or a controller that
approves arbitrary code. Before launch, the controller must compare every byte
and member of its independently frozen U package and the chosen Node executable
to the approved manifest, and launch the fixed entry under `/usr/bin/env -i`
with no `NODE_OPTIONS`, `NODE_PATH`, `--import`, `--require`, loaders or alternate
entry. The complete package and Node are checked again in U after consumers run.
A check inside JavaScript cannot undo a malicious preload executed before it;
the clean external launch is part of the same-FS operating contract, not a new L.

Only after independent AI review in separate contexts has examined the actual
C/E/R/V/K and raw engineering/delivery sources may the controller put the exact
record byte hash in **its separate reviewed U copy**, then freeze/check that
complete copy. `TRUSTED_CANDIDATE_BINDINGS` accepts only `{recordSha256}`. The
record carries exact K files, original engineering-verifier hash, engineering
and delivery-artifact complete file lists, product-record byte hash, U Node
identity and the original three independently reviewed Deep Scan hashes. Neither
E, a caller JSON `passed`, environment variables nor two self-written reviewer
names can grant this registration. Synthetic tests do not modify production pins.

U CLI (all paths absolute, output outside every input/controller tree):

```
node <reviewed-U>/ops/bin/verify-v6-candidate-evidence.mjs \
  --record <controller-approved-record.json> --product-record <K-record.json> \
  --candidate <C> --evidence <E> --reviews <R> --verifier <V> \
  --engineering <original-engineering-generation> \
  --delivery <delivery-generation/artifacts> --runtime <delivery-generation/runtime> \
  --output <new-result.json>
```

U actually executes the fixed K CLI and the original engineering CLI. K recomputes
product gates via approved V. The original engineering verifier retains its v5
signature/domain, 13 gates, 19 required tests, original migration/Deep Scan pins,
source/mode and x64 runtime evidence rules. A caller report is never their result.
Nonzero exit, null/error/invalid results, missing registration or unpassed product
or engineering gates cannot yield `v6CandidateAcceptancePassed`. This flag is
available only after both consumers and the delivery binding pass. No
`releaseCandidateApproved` or deployment authorization is emitted.

The entire engineering source/mode manifest is checked against C's actual files;
its product projection is then checked against K's complete candidate manifest
and the delivery copy. Extra reviewed tests/docs remain bound by engineering;
acceptance scripts/configuration are not omitted to avoid self-reference.

## Protected, non-deploy delivery producer

The existing root Linux x64 candidate coordinator gains only the explicit
`--v6-delivery-output` option. Without it, the old 13 gates and exact signed
artifact whitelist remain unchanged. This option is not a replacement for the
existing authorized engineering workflow (which may include live preflight);
**do not run that workflow under a free-engineering/no-provider-call instruction**.
The current development round did not run it.

With the option, only installed root-owned, no-link helper and contract files
whose hashes equal the reviewed full source manifest are imported. The helper
also checks the fixed installed coordinator invocation, root Linux x64 Node
24.20.0 identity, clean Node flags/environment, installed helper/contract and
complete fixed pnpm runtime-tools tree. All those identities are checked again
before signing. Node/pnpm here are the Linux producer's identities; U has its own
independently pinned Node and does not confuse the two machines' binary hashes.

Immediately after the real `.next` production-build gate the helper stores a
private in-process capture token. It checks the original production snapshot
again after all later gates. `.next-e2e`, `.next-performance`, a rebuilt `.next`,
a caller-provided directory or a boolean cannot substitute for that token.
After the existing engineering generation is signed, the helper copies only the
reviewed original source, the captured production build and provenance-checked
builder dependencies into a separate generation staging tree. Builder-only
Playwright browsers and `.vite` are not copied. The coordinator invokes fixed
pnpm prune and production dependency listing with `env -i`, no credentials,
private networking, read-only source/build and only deps/home/store writable:

```
pnpm prune --prod --ignore-scripts --package-import-method=copy --offline \
  --ignore-pnpmfile --config.manage-package-manager-versions=false \
  --store-dir=<the same generation's ephemeral store>
```

A nonzero sandbox run fails the V6 operation. After prune, the helper verifies
original source bytes and modes, original production build bytes/modes and the
actual complete runtime tree, freezes dependency ownership, copies to the fixed
new delivery generation and checks the copy again. It includes all files,
directories, modes and internal link targets (no hardlinks/special/escaping links).
Only the existing `.next/cache` exemption remains. Direct development packages
and builder-only artifacts are rejected. A production dependency report alone
cannot stand in for the actual tree or successful protected prune.

The new fixed output is
`/var/lib/resume-ai/v6-delivery-generations/delivery-<same-engineering-UUID>/`.
The root administrator must provision this parent root:root 0700 under safe
root-owned ancestors; no caller path grants signing authority. `artifacts/`
contains source/mode originals, complete runtime and pnpm closure inventories,
raw prune log, production dependency report and `delivery-attestation.json`.
`runtime/` contains the actual final tree. The new attestation uses the existing
root Ed25519 key and public anchor, with a separate domain
`saitu.v6-delivery-generation.v1`, and binds the original engineering attestation,
source, coordinator/helper/contract, Linux Node and pnpm identities, build ID and
all referenced raw artifact hashes. U checks the fixed anchor and generation,
compares toolchain hashes with engineering raw validation and recomputes the
actual runtime inventory before/after consumer execution. Signature or scalar
claims cannot hide rebuilt, repruned, missing, additional or mode-changed files.

If this new step fails after the old engineering seal, the coordinator never
creates, reads or writes the caller delivery output for failure recovery. It emits
a fixed failure marker and available raw prune/dependency logs on its existing
stderr file descriptor before staging cleanup. Each raw log is base64 encoded in
`saitu.v6-delivery-failure-log.v1` with its byte length and SHA-256; the controller
must capture stderr to a pre-existing trusted diagnostic sink. Missing/unreadable
logs or a broken diagnostic sink do not replace the original exception and never
trigger a fallback path write. The old signed generation is not edited. The
overall coordinator exits unsuccessfully and does not print a V6 success. A later deployment must not rebuild or mutate this delivery and keep
claiming its receipt: any such operation requires new delivery evidence. This
change deliberately does not alter the old v5 deployment verifier or migration
allowlist, and is not an instruction to deploy using an unchanged v5 flow.

## Validation and remaining execution prerequisites

The standalone native tests use generated synthetic Ed25519 keys and temporary
source packages solely to test byte binding and rejection. They do not collect
formal engineering/800/product evidence or enter actual trust tables. They cover
valid signature/shape, internal links, source and build changes, prune drift,
mode/member/link changes, wrong keys/domains/generations, stale/missing originals,
missing pnpm closure, unreviewed runtime members, environment injection, caller
passed assertions and real native platform/installation refusal. Original v5
regression tests, TypeScript and lint are recorded separately.

Actual protected Linux producer execution, its post-prune app start, root key
availability, original x64 engineering evidence and a real controller registration
are **pending**. The current machine cannot prove these by emitting synthetic
success. The offline prune may fail closed on an incompatible pnpm layout; do not
weaken source read-only, script/network restrictions or manifest checks to make
it pass. Independent review must include coordinator/control-plane/config changes
and the root invocation contract, not just the pure signature helper tests.
