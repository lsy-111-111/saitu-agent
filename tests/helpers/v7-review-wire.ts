import { expect } from "vitest";

// Independent test reader, with original keys supplied by the pre-transport
// fixture. No production encoder/decoder is used to establish conservation.
export function readDirectReviewWire(wire: Record<string, any>, originalKeys: string[], expectedBoundaryOwners: string[] = wire.fixedOrder.itemIds) {
  expect(wire.assertions).toHaveLength(originalKeys.length);
  const boundaryById = new Map<string, unknown>();
  const sharedByRef = new Map<string, Record<string, any>>();
  for (const shared of wire.sharedCandidateBoundaries ?? []) {
    expect(sharedByRef.has(shared.boundaryId)).toBe(false);
    expect(shared.boundary.itemId).toBe(shared.itemId);
    sharedByRef.set(shared.boundaryId, shared);
  }
  for (const boundary of wire.additionalCandidateBoundaries ?? []) boundaryById.set(boundary.itemId, boundary);
  const assertions: Record<string, unknown>[] = [], assertionEvidence: Record<string, any>[] = [];
  wire.assertions.forEach((row: Record<string, any>, index: number) => {
    expect(row.key).toBe(`R${String(index + 1).padStart(2, "0")}`);
    const { key: _alias, itemId, reviewPurpose, reason, competitionItems, ...own } = row;
    const key = originalKeys[index];
    if (reviewPurpose !== undefined) expect(reviewPurpose).toBe(key === "comparison" ? "comparison" : key.endsWith(".role") ? "selected_role_action" : "recommendation_fit");
    assertions.push({ key, itemId, reason });
    assertionEvidence.push({ key, itemId, ...own, competitionItems: competitionItems.map((item: Record<string, any>) => {
      const { candidateBoundaries: inlineBoundary, candidateBoundaryId, ...rest } = item;
      const shared = candidateBoundaryId === undefined ? undefined : sharedByRef.get(candidateBoundaryId);
      if (candidateBoundaryId !== undefined) {
        expect(shared).toBeDefined();
        expect(shared!.itemId).toBe(item.itemId);
        expect(inlineBoundary).toBeUndefined();
      }
      const candidateBoundaries = shared?.boundary ?? inlineBoundary;
      expect(candidateBoundaries.itemId).toBe(item.itemId);
      if (boundaryById.has(item.itemId)) expect(boundaryById.get(item.itemId)).toEqual(candidateBoundaries);
      boundaryById.set(item.itemId, candidateBoundaries);
      return rest;
    }) });
  });
  // The source fixture supplies the legal owner union for subset reviews.
  // Full-review fixtures default to their complete fixed selection order.
  expect(new Set(expectedBoundaryOwners)).toEqual(new Set(boundaryById.keys()));
  expect(expectedBoundaryOwners.every(id => wire.fixedOrder.itemIds.includes(id))).toBe(true);
  return { profileRevision: wire.profileRevision, catalogVersion: wire.catalogVersion, profile: wire.profile,
    fixedOrder: wire.fixedOrder, assertions, assertionEvidence,
    candidateBoundaries: wire.fixedOrder.itemIds.filter((id: string) => expectedBoundaryOwners.includes(id)).map((id: string) => boundaryById.get(id)) };
}
