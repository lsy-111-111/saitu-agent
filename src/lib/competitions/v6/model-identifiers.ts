/** Lossless transport aliases keep repeated long provenance IDs out of model
 * output. They do not alter facts, candidate membership, ordering or validation.
 * Only identifier fields are rewritten; user text is never interpreted as IDs.
 */
export function createModelIdentifierCodec(groups: { candidates: string[]; series: string[]; facts: string[]; students: string[] }) {
  const encodeMap = new Map<string, string>();
  const decodeMap = new Map<string, string>();
  for (const [group, values] of Object.entries(groups)) {
    const prefix = { candidates: "C", series: "S", facts: "F", students: "P" }[group];
    [...new Set(values)].sort().forEach((value, index) => {
      const alias = `@${prefix}${index}`;
      if (encodeMap.has(value) || values.includes(alias)) throw new Error("ambiguous_model_identifier");
      encodeMap.set(value, alias); decodeMap.set(alias, value);
    });
  }
  // Relations must use the same symbol as their entity endpoint. This remains
  // an explicit field allowlist: opaque assertion keys and original text are
  // never searched/replaced, and unknown IDs never create a new map entry.
  const idFields = new Set([
    "id", "itemId", "seriesId", "factId", "itemIds", "factIds", "studentFactIds", "competitionFactIds",
    "recordId", "originalSeriesId", "allowedItemIds", "candidateIds", "focusItemIds", "lastValidModelItemIds",
    "supersedesRecordIds", "legacyRecordIds",
    "retractedFactIds", "supersedesFactIds", "addedFactIds", "removedFactIds", "supersedes", "conflictsWith",
    "unresolvedFactIds", "unresolvedBoundaryFactIds",
    "sourceId", "sourceIds", "unresolvedSourceIds", "ambiguousSourceIds",
  ]);
  function transform(value: unknown, map: Map<string, string>, field = ""): unknown {
    if (typeof value === "string") return idFields.has(field) ? map.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map(item => transform(item, map, field));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item, map, key)]));
    return value;
  }
  return { encode: (value: unknown) => transform(value, encodeMap), decode: (value: unknown) => transform(value, decodeMap) };
}
