/** Deduplicate repeated evidence without selecting, truncating or summarizing it.
 * The dictionary is transport-only; candidate IDs, order and student facts stay
 * unchanged. Stable dictionary ordering also avoids a second order treatment.
 */
type Dictionary = { texts: Record<string, string>; scopes: Record<string, unknown> };

export function compactCandidateEvidence(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.candidates) || "evidenceDictionary" in input) return value;
  const texts = new Map<string, number>(), scopes = new Map<string, number>();
  function visit(item: unknown, field: string, count: boolean): unknown {
    if (typeof item === "string" && Buffer.byteLength(item, "utf8") >= 24) {
      if (count) texts.set(item, (texts.get(item) ?? 0) + 1);
      else if (textKeys.has(item)) return { $text: textKeys.get(item) };
    }
    if (field === "scope" && item && typeof item === "object" && !Array.isArray(item)) {
      const serialized = JSON.stringify(item);
      if (Buffer.byteLength(serialized, "utf8") >= 64) {
        if (count) scopes.set(serialized, (scopes.get(serialized) ?? 0) + 1);
        else if (scopeKeys.has(serialized)) return { $scope: scopeKeys.get(serialized) };
      }
    }
    if (Array.isArray(item)) return item.map(child => visit(child, field, count));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, key, count)]));
    return item;
  }
  const textKeys = new Map<string, string>(), scopeKeys = new Map<string, string>();
  visit(input.candidates, "candidates", true);
  // Count all candidate value fields, including long registration notes. Use a
  // conservative serialized-size test rather than a semantic field allowlist;
  // every selected string is still restored byte for byte by the dictionary.
  const referenceBytes = Buffer.byteLength(JSON.stringify({ $text: `t${texts.size}` }), "utf8");
  [...texts].filter(([text, n]) => {
    const literalBytes = Buffer.byteLength(JSON.stringify(text), "utf8");
    return n > 1 && n * (literalBytes - referenceBytes) > literalBytes + 16;
  }).map(([text]) => text).sort().forEach((text, i) => textKeys.set(text, `t${i}`));
  [...scopes].filter(([, n]) => n > 1).map(([scope]) => scope).sort().forEach((scope, i) => scopeKeys.set(scope, `s${i}`));
  if (!textKeys.size && !scopeKeys.size) return value;
  const dictionary: Dictionary = {
    texts: Object.fromEntries([...textKeys].map(([text, key]) => [key, text])),
    scopes: Object.fromEntries([...scopeKeys].map(([scope, key]) => [key, JSON.parse(scope)])),
  };
  // Stable shared evidence precedes the shuffled candidate rows, allowing the
  // provider's ordinary prefix cache to reuse it without altering the treatment.
  const packed = { evidenceDictionary: dictionary, ...input, candidates: visit(input.candidates, "candidates", false) };
  // Never make a small/atypical pack larger merely to apply the optimization.
  return Buffer.byteLength(JSON.stringify(packed), "utf8") < Buffer.byteLength(JSON.stringify(value), "utf8") ? packed : value;
}

/** Exact reconstruction for offline evidence audits, never a model response parser. */
export function expandCandidateEvidence(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const dictionary = input.evidenceDictionary as Dictionary | undefined;
  if (!dictionary) return value;
  function expand(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(expand);
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      if (Object.keys(row).length === 1 && ("$text" in row || "$scope" in row)) {
        const kind = "$text" in row ? "texts" : "scopes";
        const key = row[kind === "texts" ? "$text" : "$scope"];
        if (typeof key !== "string" || !Object.hasOwn(dictionary![kind], key)) throw new Error("missing_evidence_dictionary_reference");
        return structuredClone(dictionary![kind][key]);
      }
      return Object.fromEntries(Object.entries(row).map(([key, child]) => [key, expand(child)]));
    }
    return item;
  }
  const { evidenceDictionary: _dictionary, ...rest } = input;
  return { ...rest, candidates: expand(input.candidates) };
}
