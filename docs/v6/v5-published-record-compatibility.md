# V5 presentation over current reviewed records

The V5 request and response schemas and old saved-result readers remain unchanged.
The non-V6 branch of `/api/ai/competition-recommend` now presents a maximum of
three results selected by the V6 deterministic A1 plan. It never invokes the old
135-series recommendation/explanation pipeline or an upstream model.

## Facts and qualification

The server builds a `record_only` decision context. Its candidates must pass the
existing canonical `selectPublishedDecisionRecords` check: exact record identity,
current content digest, publication tier/state and independent same-digest dual
review. Approval of another track in the series grants no authority. This mode
uses only that record's eligibility rules. Missing rules or unconfirmed facts
stay unknown; the old qualification score cannot fill the gap. A selected legacy
track must match the exact current record's track; otherwise that series receives
an explicit unavailable-track explanation rather than substitution.

The default V6 context behavior is unchanged. The internal option is fixed by the
server for V5; no request schema field accepts it, a catalog or another ledger.
The separate read-only probe reports remaining default V6 legacy dependencies;
its differences are not automatically correctness defects.

The presentation uses the same record's edition, track, task, role, costs,
registration note, sources and official fact references. Main sourceUrl and evidenceRefs.source come only from
applicable official facts accepted by isDecisionEvidenceFact/isEvidenceForRecord:
their sourceIds must resolve uniquely to body_read official sources with the
matching per-source scope and an HTTP(S) URL. Merely appearing in record.sources
is not citation authority. Unchecked legacy metadata remains stored, but cannot
be selected as a citation; if no fact-backed source exists, presentation fails
closed. Cached responses must match the same source list and exact official
fact/sourceRef/URL projection. The adapter version is v2 so an older cache key
cannot authorize the previous source projection. Historical registration
maps to V5 `stale`. Open/upcoming claims require current official registration
facts belonging to that exact record; the open badge also uses the existing
`validateDecisionRecord` 72-hour current-registration policy, unchanged. Otherwise
status is unknown. Suggestions
and unknown conditions are not promoted to official facts or capability claims.

Native goal/task/experience/preparation/growth dimensions map to V5
`goalsOutputs`/`subjectTask`/`skillsEvidence`/`teamResources`/`maturity` with their
existing 30/25/20/15/10 weights. The existing evidence-interval calibration has
zero adjustment, timing and data-confidence points. The lower-bound sum supplies
the display score; notices preserve the interval. This is not an award probability.
Only a ready, eligible report item gets a qualified role; exploratory/conditional
items remain references. No quality threshold table or gold label was edited.

`competitionId` remains the stable series ID, including newly reviewed series
absent from the old catalog. `recommendedTrack.id`/`evaluatedTrackId` are exact
track IDs; `recommendedTrack.evidenceRef` carries the exact record ID. Alternatives
come from the same rule plan. `candidateAudit` retains series-keyed summaries for
old V5 lookup clients and additionally contains an entry keyed by each exact
record ID. Exact entries identify content_pending/excluded/not_selected/selected;
series approval never hides pending sibling records. This uses the existing
string-keyed V5 audit schema without changing the old saved-result reader.

## Signed sessions and cache

`currentDecisionPublicationBinding` hashes the current canonical record bytes and
the exact currently approved record/content-digest set. The existing signed
qualification-summary digest now includes this binding in the snapshot catalog
version. Its old legacy qualification entries are retained only for existing
question/track integrity checks; they do not authorize V5 output qualification.

A correctly signed pre-upgrade token or a token bound to revoked/changed content
is rejected by the existing `QUALIFICATION_SNAPSHOT_CHANGED` 409 response. Users
rebuild the conversation; the server does not accept unsigned profiles or
silently migrate an old signed summary. Normalize/clarify still use their
existing contracts and token creation flow.

The actual transition/cache key includes the publication binding, engine,
profile revision and presentation adapter version. The producer checks the binding
before returning a successful response. A further check after the real transition
returns covers a cached replay as well. Before delivery the exact result record/
track/source identities and any now-open badge are revalidated at the actual
current time, so session cache TTL cannot extend a stale badge. A change at either boundary returns 409;
an old cached response cannot be served under a newly signed current binding.
Existing rate-limit storage, encryption and cache implementations are unchanged.

## Verification and limits

Tests use real modules/API routes and an isolated in-memory copy of the canonical
review ledger for denial tests; they never write approvals or the actual ledger.
They exercise full normalize → clarify → recommend, current-token replay,
pre-upgrade token rejection, withdrawal/content changes, producer/replay boundary
changes, exact unpublished siblings, track non-substitution, new series, saved
result compatibility, absent canonical records and unsigned/options injection.
Upstream fetch is forbidden in the new tests.

The original 40 public-profile probe is preserved and rerun only as a publication
and schema check, not a ranking-quality gold set. Its real current catalog snapshot
has 45 published records; future content or approval changes require revalidation.
The separate default V6 risk probe preserves observed qualification dependencies
without changing that default path. This development work makes no formal
acceptance, suitability, paid-model, deployment or content-approval claim.
