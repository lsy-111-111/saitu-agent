/** First-stage evidence references. Full text stays in the frozen server
 * dictionary and is restored for the independent support check. No candidate,
 * fact identity, scope, status, task, role or unresolved condition is removed.
 */
type Row = Record<string, unknown>;
export function indexMatchingEvidence(value: unknown) {
  const input = value as Row;
  if (!input || typeof input !== "object" || !Array.isArray(input.candidates)) throw new Error("matching_candidates_required");
  const dictionary: Record<string, Row> = {};
  const moduleDictionary: Record<string, unknown> = {};
  const moduleIds = new Map(input.candidates.map((candidate: Row) => String(candidate.itemId)).sort().map((id, index) => [id, index]));
  const candidates: Array<Row & { facts: Array<Row & { textReference: { factId: string } }> }> = input.candidates.map((candidate: Row) => ({ ...candidate,
    ...Object.fromEntries(["investment", "benefits"].filter(field => Object.hasOwn(candidate, field)).map(field => {
      const moduleId = `m${moduleIds.get(String(candidate.itemId))}.${field}`;
      moduleDictionary[moduleId] = candidate[field];
      return [field, { moduleReference: moduleId }];
    })),
    facts: (candidate.facts as Row[]).map(fact => {
      if (typeof fact.id !== "string" || typeof fact.text !== "string") throw new Error("complete_fact_identity_and_text_required");
      if (dictionary[fact.id] && JSON.stringify(dictionary[fact.id]) !== JSON.stringify(fact)) throw new Error("ambiguous_fact_dictionary_identity");
      dictionary[fact.id] = fact;
      const { text: _text, ...metadata } = fact;
      return { ...metadata, textReference: { factId: fact.id } };
    }),
  }));
  const sortedDictionary = Object.fromEntries(Object.keys(dictionary).sort().map(id => [id, dictionary[id]]));
  const sortedModules = Object.fromEntries(Object.keys(moduleDictionary).sort().map(id => [id, moduleDictionary[id]]));
  return { input: { ...input, candidates, factTextMode: "server_dictionary_references" }, dictionary: sortedDictionary, moduleDictionary: sortedModules,
    factCount: Object.keys(dictionary).length };
}

/** Offline equality/audit helper; not a model response parser. */
export function restoreMatchingEvidence(value: unknown, dictionary: Record<string, Row>, moduleDictionary: Record<string, unknown> = {}) {
  const { factTextMode: _mode, ...input } = value as Row;
  return { ...input, candidates: (input.candidates as Row[]).map(candidate => ({ ...candidate,
    ...Object.fromEntries(["investment", "benefits"].filter(field => candidate[field] && typeof candidate[field] === "object" && "moduleReference" in (candidate[field] as Row)).map(field => {
      const id = (candidate[field] as Row).moduleReference;
      if (typeof id !== "string" || !Object.hasOwn(moduleDictionary, id)) throw new Error("missing_frozen_module_reference");
      return [field, moduleDictionary[id]];
    })),
    facts: (candidate.facts as Row[]).map(indexed => {
      const { textReference, ...metadata } = indexed;
      const id = (textReference as Row)?.factId;
      if (typeof id !== "string" || !dictionary[id] || JSON.stringify(metadata) !== JSON.stringify(Object.fromEntries(Object.entries(dictionary[id]).filter(([key]) => key !== "text")))) throw new Error("fact_index_dictionary_binding_mismatch");
      return dictionary[id];
    }),
  })) };
}
