import path from "node:path";
import { realpath } from "node:fs/promises";
import { canonicalHash, same, requirePolicy, isHash, readBoundJson, readBoundBytes, assertUnique } from "./evaluation-policy.mjs";

const CONTRACT = "layer_primary_with_explicit_secondary_sources.v7.1";
const componentFor = layer => layer === "ranking" ? "ranking" : "nonranking";
const hashKey = id => id === "ranking" ? "rankingSourceSnapshotSha256" : "sourceSnapshotSha256";

function sourceReference(component, source, kind) {
  if (component.id === "ranking") return source[kind];
  if (kind === "raw") return { path: source.rawSourceArtifact, sha256: source.rawSourceSha256 };
  const member = source.bodyArtifact;
  if (typeof member !== "string") throw new Error("source_body_reference_missing");
  return { path: member.startsWith("artifacts/") || path.isAbsolute(member) ? member : path.posix.join(path.posix.dirname(component.manifest.path), "private", member), sha256: source.bodySha256 };
}

/** Explicit layer-primary plus secondary dependencies. All authority comes from
 * registered challenge bytes, frozen component records and re-read source bytes. */
export async function verifyCaseSourceDependencies({ evidenceRoot, manifest, config }) {
  requirePolicy(manifest);
  if (!isHash(manifest.caseSourceDependenciesSha256) || manifest.sourceDependencies?.sha256 !== manifest.caseSourceDependenciesSha256) throw new Error("registered_case_source_dependencies_required");
  const envelope = (await readBoundJson(evidenceRoot, manifest.sourceDependencies)).value;
  requirePolicy(envelope);
  if (envelope.schemaVersion !== "saitu.case-source-dependencies.v7.1" || envelope.contract !== CONTRACT || !Array.isArray(envelope.components) ||
      envelope.components.length !== 2 || !Array.isArray(envelope.cases)) throw new Error("versioned_explicit_multi_component_source_contract_required");
  if (!same(manifest.originalCaseMetadata, envelope.originalCaseMetadata)) throw new Error("challenge_original_case_metadata_reference_changed");
  const metadata = (await readBoundJson(evidenceRoot, envelope.originalCaseMetadata)).value;
  requirePolicy(metadata);
  if (!Array.isArray(metadata.cases) || !Array.isArray(manifest.cases) || metadata.cases.length !== manifest.cases.length || envelope.cases.length !== manifest.cases.length) throw new Error("exact_case_source_dependency_scope_required");
  for (const rows of [metadata.cases, manifest.cases, envelope.cases]) assertUnique(rows.map(row => row.caseId), "duplicate_case_source_dependency_identity");
  const relocations = envelope.relocations ? (await readBoundJson(evidenceRoot, envelope.relocations)).value : { relocations: [] };
  if (!Array.isArray(relocations.relocations) || relocations.relocations.length && (relocations.schemaVersion !== "saitu.source-reference-relocation.v7.1" || typeof relocations.root !== "string" || !path.isAbsolute(relocations.root))) throw new Error("explicit_source_relocation_contract_required");
  const actualEvidenceRoot = await realpath(evidenceRoot);
  if (relocations.relocations.length && relocations.root !== actualEvidenceRoot) throw new Error("source_relocation_root_must_match_real_evidence_root");
  const relocationIndex = new Map();
  for (const relocation of relocations.relocations) {
    const key = JSON.stringify([relocation.component, relocation.sourceId, relocation.kind]);
    if (relocationIndex.has(key)) throw new Error("duplicate_source_relocation");
    relocationIndex.set(key, relocation);
  }
  const usedRelocations = new Set(), checkedFiles = new Map(), components = new Map();
  for (const component of envelope.components) {
    if (!["ranking", "nonranking"].includes(component.id) || components.has(component.id) || component.canonicalSha256 !== config[hashKey(component.id)] || manifest[hashKey(component.id)] !== component.canonicalSha256) throw new Error("registered_source_component_changed");
    const snapshot = (await readBoundJson(evidenceRoot, component.manifest)).value;
    const expectedHash = component.id === "ranking" ? canonicalHash(snapshot) : canonicalHash(snapshot.sources);
    if (expectedHash !== component.canonicalSha256 || !Array.isArray(snapshot.sources) || (component.id === "ranking" && snapshot.catalogSha256 !== config.catalogSha256)) throw new Error("source_component_canonical_hash_changed");
    assertUnique(snapshot.sources.map(row => row.sourceId), "duplicate_frozen_component_source_id");
    const sources = new Map();
    for (const source of snapshot.sources) {
      const bound = { sourceRecordSha256: canonicalHash(source) };
      for (const kind of ["raw", "body"]) {
        const originalReference = sourceReference(component, source, kind);
        let reference = originalReference;
        if (typeof originalReference?.path !== "string") throw new Error("frozen_source_original_reference_required");
        if (path.isAbsolute(originalReference.path)) {
          const key = JSON.stringify([component.id, source.sourceId, kind]), relocation = relocationIndex.get(key);
          if (!relocation || !same(relocation.originalSnapshot, component.manifest) || !same(relocation.originalReference, originalReference)) throw new Error("exact_frozen_source_relocation_required");
          const relative = path.relative(relocations.root, originalReference.path);
          if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..") || !same(relocation.repositoryRelativeReference, { path: relative, sha256: originalReference.sha256 })) throw new Error("source_relocation_must_keep_exact_repository_relative_member");
          reference = relocation.repositoryRelativeReference;
          const [originalRealpath, aliasRealpath] = await Promise.all([realpath(originalReference.path), realpath(path.resolve(actualEvidenceRoot, reference.path))]);
          if (originalRealpath !== aliasRealpath) throw new Error("source_relocation_must_keep_same_actual_realpath");
          usedRelocations.add(key);
        }
        const oldSha = checkedFiles.get(reference.path);
        if (oldSha && oldSha !== reference.sha256) throw new Error("same_source_member_has_conflicting_byte_hashes");
        if (!oldSha) await readBoundBytes(evidenceRoot, reference);
        checkedFiles.set(reference.path, reference.sha256); bound[kind] = reference;
      }
      sources.set(source.sourceId, bound);
    }
    components.set(component.id, { ...component, sources });
  }
  if (usedRelocations.size !== relocationIndex.size) throw new Error("unused_or_unbound_source_relocation");
  const originalById = new Map(metadata.cases.map(row => [row.caseId, row])), dependencyById = new Map(envelope.cases.map(row => [row.caseId, row]));
  const secondaryCases = [], secondarySourceIds = new Set();
  for (const identity of manifest.cases) {
    const original = originalById.get(identity.caseId), row = dependencyById.get(identity.caseId), primary = componentFor(identity.layer);
    if (!original || !row || ["layer", "inputSha256", "answerSha256", "sourceSnapshotSha256"].some(key => identity[key] !== original[key]) ||
        !same(identity.sourceEvidenceIds, original.sourceEvidenceIds) || row.inputSha256 !== identity.inputSha256 || row.answerSha256 !== identity.answerSha256 ||
        row.primaryComponentId !== primary || row.primarySourceSnapshotSha256 !== config[hashKey(primary)] || identity.sourceSnapshotSha256 !== row.primarySourceSnapshotSha256 || !Array.isArray(row.sources)) throw new Error("case_original_metadata_or_primary_component_changed");
    assertUnique(original.sourceEvidenceIds, "duplicate_case_source_evidence_id");
    assertUnique(row.sources.map(source => source.sourceId), "duplicate_per_case_source_binding");
    if (!same([...original.sourceEvidenceIds].sort(), row.sources.map(source => source.sourceId).sort())) throw new Error("complete_per_case_source_dependency_closure_required");
    const required = new Set([primary]);
    for (const dependency of row.sources) {
      const expectedComponent = components.get(primary).sources.has(dependency.sourceId) ? primary : primary === "ranking" ? "nonranking" : "ranking";
      const component = components.get(expectedComponent), source = component.sources.get(dependency.sourceId);
      if (!source || dependency.componentId !== expectedComponent || dependency.componentSha256 !== component.canonicalSha256 || dependency.sourceRecordSha256 !== source.sourceRecordSha256 ||
          !same(dependency.raw, source.raw) || !same(dependency.body, source.body)) throw new Error("case_source_bound_to_wrong_component_or_original_bytes");
      required.add(expectedComponent);
      if (expectedComponent !== primary) secondarySourceIds.add(dependency.sourceId);
    }
    if (!Array.isArray(row.requiredComponentIds) || !same([...required].sort(), [...row.requiredComponentIds].sort()) || !unique(row.requiredComponentIds)) throw new Error("explicit_required_component_set_changed");
    if (required.size > 1) secondaryCases.push(identity.caseId);
  }
  return { schemaVersion: "saitu.case-source-dependency-verification.v7.1", dependencyManifestSha256: manifest.caseSourceDependenciesSha256,
    originalMetadataSha256: envelope.originalCaseMetadata.sha256, cases: manifest.cases.length, components: 2,
    componentSourceRecords: [...components.values()].reduce((sum, component) => sum + component.sources.size, 0), uniqueSourceFiles: checkedFiles.size,
    crossComponentCases: secondaryCases.length, crossComponentCaseIds: secondaryCases, crossComponentSourceIds: [...secondarySourceIds].sort(), sourceBytesVerified: true };
}
const unique = values => new Set(values).size === values.length;
