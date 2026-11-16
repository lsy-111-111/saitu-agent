type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
function columns(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || !value.every(row)) return null;
  const first = Object.keys(value[0]).sort();
  return value.every(item => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(first)) ? first : null;
}
/** Fixed column headers remove repeated keys, without summarizing any cell. */
export function compactMatchingTables(value: unknown): unknown {
  if (!row(value) || !Array.isArray(value.candidates)) return value;
  const signatures = new Set<string>();
  const collect = (item: unknown) => {
    const cols = columns(item);
    if (cols) signatures.add(JSON.stringify(cols));
    if (Array.isArray(item)) item.forEach(collect);
    else if (row(item)) Object.values(item).forEach(collect);
  };
  collect(value.candidates);
  const schemas = Object.fromEntries([...signatures].sort().map((signature, index) => [`t${index}`, JSON.parse(signature) as string[]]));
  const names = new Map(Object.entries(schemas).map(([name, cols]) => [JSON.stringify(cols), name]));
  const encode = (item: unknown): unknown => {
    const cols = columns(item);
    if (cols) return { $table: names.get(JSON.stringify(cols)), rows: (item as Row[]).map(item => cols.map(key => encode(item[key]))) };
    if (Array.isArray(item)) return item.map(encode);
    if (row(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, encode(child)]));
    return item;
  };
  return { tableSchemas: schemas, ...value, candidates: encode(value.candidates) };
}

export function expandMatchingTables<T>(value: T): T {
  if (!row(value) || !row(value.tableSchemas)) return value;
  const schemas = value.tableSchemas;
  const decode = (item: unknown): unknown => {
    if (row(item) && Object.keys(item).sort().join(",") === "$table,rows") {
      const cols = typeof item.$table === "string" ? schemas[item.$table] : null;
      if (!Array.isArray(cols) || !cols.every(key => typeof key === "string") || !Array.isArray(item.rows)) throw new Error("invalid_matching_table");
      return item.rows.map(values => {
        if (!Array.isArray(values) || values.length !== cols.length) throw new Error("matching_table_column_count_mismatch");
        return Object.fromEntries(cols.map((key, index) => [key, decode(values[index])]));
      });
    }
    if (Array.isArray(item)) return item.map(decode);
    if (row(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, decode(child)]));
    return item;
  };
  const { tableSchemas: _schemas, ...input } = value;
  return { ...input, candidates: decode(input.candidates) } as T;
}
