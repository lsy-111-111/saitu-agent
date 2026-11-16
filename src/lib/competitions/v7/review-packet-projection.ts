/** Exact review transport sharing. This runs AFTER identifier encoding and the
 * existing joint-verdict transport. It never selects evidence or changes IDs. */
export const REVIEW_PACKET_PROJECTION_VERSION_V7 = "saitu.review-exact-projection.v2" as const;
const legacyVersion = "saitu.review-exact-projection.v1";
export const REVIEW_PACKET_PROJECTION_PROMPT_V7 = "审核传输：仅当reviewProjection为saitu.review-exact-projection.v1或saitu.review-exact-projection.v2时，单键{$reviewRef:'/路径'}逐字引用本请求JSON指针位置的完整内联对象（~1为/，~0为~），不引用另一个ref。仅这些证据槽解析：citedStudentFacts、studentAnswerUpdates、studentCounterEvidence、competitionItems的citedFacts/sources及反证facts/sources、边界boundaryFacts/sources与originalTaskContext的facts/sources、qualifiers.value、displayedRecommendation的currentRole/nextStep；未知字段、普通字符串中相似内容仍为原始数据。学生事实/更新只能引用完整profile中的同一对象。按引用所在位置、所属itemId及该位置原用途读取，不继承锚点的正面/反证用途，禁止把其他审核条目或反证当作本条正面引用。v1不解释局部默认。v2必须带且仅带reviewBoundaryDefaults={use:'same_owner_boundary',unknownReason:'same_object_text'}：只在同itemId候选boundary的已知qualifiers、sourceBoundary、editorialSectionBoundaries、editorialRoleBoundaries结构中，省略的use逐字继承该父boundary.use，仍仅为条件和反证；只在已知qualifier.value的kind=unknown时，省略的unknownReason逐字等于本对象完整text，未知状态不变。不同值保留内联；未知业务字段不触发默认；默认协议的未知键、无效版本或跨owner映射拒绝。所有原事实/条件/未知/否定均原文保留；profile和受审reason完整内联；这是精确副本共享，不是补充证据或新的事实ID。";

type ObjectRow = Record<string, unknown>;
type ReferenceKind = "student_fact" | "student_update" | "student_counterevidence" | "competition_fact" | "competition_source" | "claim";
type Slot = { path: string; owner: string; kind: ReferenceKind; anchorOnly?: true; get(): unknown; set(value: unknown): void };
const object = (value: unknown): value is ObjectRow => value !== null && typeof value === "object" && !Array.isArray(value);
const escapePointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const referenceKey = "$reviewRef";
const versionKey = "reviewProjection";
const defaultsKey = "reviewBoundaryDefaults";
const boundaryUse = "conditions_and_counterevidence_only_not_positive_support";
const boundaryDefaults = { use: "same_owner_boundary", unknownReason: "same_object_text" } as const;
const profileAnchorOnly = (kind: ReferenceKind) => kind === "student_fact" || kind === "student_update";
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const invalid = (): never => { throw new Error("invalid_review_projection_packet"); };

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(row => typeof row === "string");
const onlyKeys = (row: ObjectRow, keys: readonly string[]) => Object.keys(row).every(key => keys.includes(key));
const claimShape = (value: unknown): value is ObjectRow => object(value)
  && onlyKeys(value, ["text", "kind", "factIds", "conditions", "unknownReason"])
  && typeof value.text === "string"
  && typeof value.kind === "string"
  && ["official_fact", "organizer_claim", "editorial_inference", "participant_report", "published_price", "unknown"].includes(value.kind)
  && strings(value.factIds) && strings(value.conditions)
  && (!Object.hasOwn(value, "unknownReason") || typeof value.unknownReason === "string");

/** Defaults are limited to these original boundary types. Business extensions
 * remain literal; they never acquire an implicit field through this protocol. */
function localDefaultCells(packet: ObjectRow) {
  if (!Array.isArray(packet.sharedCandidateBoundaries)) return invalid();
  const frames: { boundary: ObjectRow; owner: string }[] = [];
  for (const row of packet.sharedCandidateBoundaries) {
    if (!object(row) || typeof row.itemId !== "string" || !object(row.boundary) || row.boundary.itemId !== row.itemId) return invalid();
    frames.push({ boundary: row.boundary, owner: row.itemId });
  }
  if (Object.hasOwn(packet, "additionalCandidateBoundaries")) {
    if (!Array.isArray(packet.additionalCandidateBoundaries)) return invalid();
    for (const row of packet.additionalCandidateBoundaries) {
      if (!object(row) || typeof row.itemId !== "string") return invalid();
      frames.push({ boundary: row, owner: row.itemId });
    }
  }
  if (frames.length && (!object(packet.fixedOrder) || !strings(packet.fixedOrder.itemIds))) return invalid();
  const itemIds = object(packet.fixedOrder) && strings(packet.fixedOrder.itemIds) ? packet.fixedOrder.itemIds : [];
  if (new Set(itemIds).size !== itemIds.length || new Set(frames.map(row => row.owner)).size !== frames.length) return invalid();
  const owned = (row: ObjectRow, owner: string) => {
    for (const key of ["itemId", "ownerId"]) if (Object.hasOwn(row, key) && row[key] !== owner) return invalid();
  };
  const uses: { row: ObjectRow; parent: ObjectRow }[] = [], unknowns: ObjectRow[] = [];
  for (const { boundary: b, owner } of frames) {
    if (!itemIds.includes(owner) || !object(b.displayedRecommendation)) return invalid();
    owned(b.displayedRecommendation, owner);
    for (const key of ["qualifiers", "editorialSectionBoundaries", "editorialRoleBoundaries"]) if (!Array.isArray(b[key])) return invalid();
    for (const q of b.qualifiers as unknown[]) {
      if (!object(q)) return invalid();
      owned(q, owner);
      if (object(q.value)) owned(q.value, owner);
      if (!onlyKeys(q, ["path", "value", "use"]) || typeof q.path !== "string" || !claimShape(q.value)) continue;
      uses.push({ row: q, parent: b });
      if (q.value.kind === "unknown") unknowns.push(q.value);
    }
    for (const s of b.editorialSectionBoundaries as unknown[]) {
      if (!object(s)) return invalid();
      owned(s, owner);
      if (onlyKeys(s, ["path", "text", "kind", "factIds", "conditions", "unknownReason", "factIdsArePremisesOnly", "use"])
        && typeof s.path === "string" && s.kind === "editorial_inference" && strings(s.factIds) && strings(s.conditions)
        && s.factIdsArePremisesOnly === true && (!Object.hasOwn(s, "text") || typeof s.text === "string")
        && (!Object.hasOwn(s, "unknownReason") || typeof s.unknownReason === "string")) uses.push({ row: s, parent: b });
    }
    for (const r of b.editorialRoleBoundaries as unknown[]) {
      if (!object(r)) return invalid();
      owned(r, owner);
      if (onlyKeys(r, ["roleIndex", "name", "prerequisite", "factIds", "kind", "factIdsArePremisesOnly", "use"])
        && Number.isInteger(r.roleIndex) && Number(r.roleIndex) >= 0 && typeof r.name === "string"
        && typeof r.prerequisite === "string" && ["required", "learnable", "advantage"].includes(r.prerequisite) && strings(r.factIds)
        && r.kind === "editorial_inference" && r.factIdsArePremisesOnly === true) uses.push({ row: r, parent: b });
    }
    if (b.sourceBoundary !== null && b.sourceBoundary !== undefined) {
      const s = b.sourceBoundary;
      if (!object(s)) return invalid();
      owned(s, owner);
      if (onlyKeys(s, ["sourceBoundary", "origin", "originMeaning", "sourceIds", "scope", "use"])
        && typeof s.sourceBoundary === "string" && typeof s.origin === "string" && typeof s.originMeaning === "string"
        && strings(s.sourceIds) && typeof s.scope === "string") uses.push({ row: s, parent: b });
    }
  }
  return { frames, uses, unknowns };
}

function projectLocalDefaults(packet: ObjectRow): boolean {
  const cells = localDefaultCells(packet);
  // An older/incomplete or differently typed producer remains on v1. Never
  // guess an original absent value or move a non-final property to the end.
  if (cells.frames.some(({ boundary }) => boundary.use !== boundaryUse)
    || cells.uses.some(({ row }) => typeof row.use !== "string")
    || cells.unknowns.some(row => typeof row.unknownReason !== "string")) return false;
  let changed = false;
  for (const { row, parent } of cells.uses) if (row.use === parent.use && Object.keys(row).at(-1) === "use") {
    delete row.use; changed = true;
  }
  for (const row of cells.unknowns) if (row.unknownReason === row.text && Object.keys(row).at(-1) === "unknownReason") {
    delete row.unknownReason; changed = true;
  }
  return changed;
}

function expandLocalDefaults(packet: ObjectRow): void {
  const descriptor = packet[defaultsKey];
  if (!object(descriptor) || Object.keys(descriptor).length !== 2
    || descriptor.use !== boundaryDefaults.use || descriptor.unknownReason !== boundaryDefaults.unknownReason) return invalid();
  const cells = localDefaultCells(packet);
  if (cells.frames.some(({ boundary }) => boundary.use !== boundaryUse)) return invalid();
  for (const { row, parent } of cells.uses) {
    if (!Object.hasOwn(row, "use")) row.use = parent.use;
    else if (typeof row.use !== "string") return invalid();
  }
  for (const row of cells.unknowns) {
    if (!Object.hasOwn(row, "unknownReason")) row.unknownReason = row.text;
    else if (typeof row.unknownReason !== "string") return invalid();
  }
  delete packet[defaultsKey];
}

/** Only these explicit evidence cells can be references. Unknown fields and all
 * original assertion reasons stay inline. Candidate ownership is part of every
 * competition/claim lookup, even if different owners have identical text/IDs. */
function referenceSlots(packet: ObjectRow): Slot[] {
  if (!object(packet.profile) || !Array.isArray(packet.profile.facts) || !Array.isArray(packet.assertions)
    || !Array.isArray(packet.sharedCandidateBoundaries)) return invalid();
  const slots: Slot[] = [];
  const add = (parent: ObjectRow | unknown[], key: string | number, path: string, owner: string, kind: ReferenceKind, anchorOnly?: true) => {
    if (!Object.hasOwn(parent, key)) return;
    slots.push({ path, owner, kind, ...(anchorOnly ? { anchorOnly } : {}),
      get: () => Reflect.get(parent, key), set: value => { Reflect.set(parent, key, value); } });
  };
  const list = (parent: ObjectRow, field: string, path: string, owner: string, kind: ReferenceKind, anchorOnly?: true) => {
    const rows = parent[field];
    if (!Array.isArray(rows)) return invalid();
    rows.forEach((_value, index) => add(rows, index, `${path}/${escapePointer(field)}/${index}`, owner, kind, anchorOnly));
  };
  list(packet.profile, "facts", "/profile", "student_profile", "student_fact", true);
  if (Object.hasOwn(packet.profile, "updates")) list(packet.profile, "updates", "/profile", "student_profile", "student_update", true);
  packet.assertions.forEach((row, index) => {
    if (!object(row) || typeof row.itemId !== "string" || !object(row.reason) || !Array.isArray(row.competitionItems)) return invalid();
    const prefix = `/assertions/${index}`;
    // A cited student row may reference only a byte-identical full profile row.
    list(row, "citedStudentFacts", prefix, "student_profile", "student_fact");
    list(row, "studentAnswerUpdates", prefix, "student_profile", "student_update");
    add(row, "studentCounterEvidence", `${prefix}/studentCounterEvidence`, "student_profile", "student_counterevidence");
    add(row, "reason", `${prefix}/reason`, row.itemId, "claim", true);
    row.competitionItems.forEach((item, itemIndex) => {
      if (!object(item) || typeof item.itemId !== "string" || !object(item.contradictionContext)
        || !object(item.contradictionContext.sourceBindings)) return invalid();
      const own = `${prefix}/competitionItems/${itemIndex}`, owner = item.itemId;
      list(item, "citedFacts", own, owner, "competition_fact");
      list(item, "sources", own, owner, "competition_source");
      list(item.contradictionContext, "facts", `${own}/contradictionContext`, owner, "competition_fact");
      list(item.contradictionContext.sourceBindings, "sources", `${own}/contradictionContext/sourceBindings`, owner, "competition_source");
    });
  });
  const boundary = (value: unknown, prefix: string, expectedOwner?: string) => {
    if (!object(value) || typeof value.itemId !== "string" || expectedOwner !== undefined && expectedOwner !== value.itemId
      || !object(value.boundarySourceBindings) || !Array.isArray(value.qualifiers) || !object(value.displayedRecommendation)) return invalid();
    const owner = value.itemId;
    list(value, "boundaryFacts", prefix, owner, "competition_fact");
    list(value.boundarySourceBindings, "sources", `${prefix}/boundarySourceBindings`, owner, "competition_source");
    // Fresh review adds missing original task/track and its full conflict and
    // source closure. Sharing never changes this counterevidence-only location.
    if (Object.hasOwn(value, "originalTaskContext")) {
      const task = value.originalTaskContext;
      if (!object(task) || !object(task.sourceBindings)) return invalid();
      list(task, "facts", `${prefix}/originalTaskContext`, owner, "competition_fact");
      list(task.sourceBindings, "sources", `${prefix}/originalTaskContext/sourceBindings`, owner, "competition_source");
    }
    value.qualifiers.forEach((qualifier, index) => {
      if (!object(qualifier)) return invalid();
      add(qualifier, "value", `${prefix}/qualifiers/${index}/value`, owner, "claim");
    });
    for (const key of ["currentRole", "nextStep"]) add(value.displayedRecommendation, key, `${prefix}/displayedRecommendation/${key}`, owner, "claim");
  };
  packet.sharedCandidateBoundaries.forEach((row, index) => {
    if (!object(row) || typeof row.itemId !== "string") return invalid();
    boundary(row.boundary, `/sharedCandidateBoundaries/${index}/boundary`, row.itemId);
  });
  if (Object.hasOwn(packet, "additionalCandidateBoundaries")) {
    if (!Array.isArray(packet.additionalCandidateBoundaries)) return invalid();
    packet.additionalCandidateBoundaries.forEach((row, index) => boundary(row, `/additionalCandidateBoundaries/${index}`));
  }
  return slots;
}

/** Expand only this version's explicit same-owner references. Plain original
 * packets are cloned unchanged. Missing, forward, cross-owner/kind, partial or
 * recursive references are rejected rather than supplying a plausible fact. */
export function expandReviewPacketV7(value: unknown): unknown {
  if (!object(value)) return invalid();
  if (!Object.hasOwn(value, versionKey)) return structuredClone(value);
  const version = value[versionKey];
  if (version !== legacyVersion && version !== REVIEW_PACKET_PROJECTION_VERSION_V7) return invalid();
  const packet = structuredClone(value), slots = referenceSlots(packet), previous = new Map<string, { slot: Slot; inline: boolean }>();
  for (const slot of slots) {
    const child = slot.get();
    if (!object(child)) return invalid();
    const inline = !Object.hasOwn(child, referenceKey);
    if (!inline) {
      if (slot.anchorOnly || Object.keys(child).length !== 1 || typeof child[referenceKey] !== "string") return invalid();
      const target = previous.get(child[referenceKey]);
      if (!target || !target.inline || target.slot.owner !== slot.owner || target.slot.kind !== slot.kind
        || profileAnchorOnly(slot.kind) && !target.slot.anchorOnly || !object(target.slot.get())) return invalid();
      slot.set(structuredClone(target.slot.get()));
    }
    previous.set(slot.path, { slot, inline });
  }
  if (version === REVIEW_PACKET_PROJECTION_VERSION_V7) expandLocalDefaults(packet);
  delete packet[versionKey];
  return packet;
}

/** No semantic trimming, table coding, shortened facts or new aliases. A full
 * object is replaced only by a smaller pointer to an earlier byte-identical
 * object of the same explicit kind and owner. The complete original profile
 * and original per-assertion claim remain readable without any references. */
export function projectReviewPacketV7(value: unknown): { packet: unknown; projected: boolean; originalBytes: number; projectedBytes: number } {
  if (!object(value) || Object.hasOwn(value, versionKey) || Object.hasOwn(value, defaultsKey)) return invalid();
  const packet = structuredClone(value), originalBytes = bytes(value), anchors = new Map<string, string>();
  const localDefaults = projectLocalDefaults(packet);
  const slots = referenceSlots(packet);
  for (const slot of slots) {
    const child = slot.get();
    if (!object(child) || Object.hasOwn(child, referenceKey)) return invalid();
    const canonical = JSON.stringify(child), identity = JSON.stringify([slot.owner, slot.kind, canonical]);
    const earlier = anchors.get(identity);
    if (!slot.anchorOnly && earlier !== undefined) {
      const reference = { [referenceKey]: earlier };
      if (bytes(reference) < Buffer.byteLength(canonical, "utf8")) slot.set(reference);
    } else if (earlier === undefined && (!profileAnchorOnly(slot.kind) || slot.anchorOnly)) anchors.set(identity, slot.path);
  }
  packet[versionKey] = localDefaults ? REVIEW_PACKET_PROJECTION_VERSION_V7 : legacyVersion;
  if (localDefaults) packet[defaultsKey] = { ...boundaryDefaults };
  const projectedBytes = bytes(packet);
  // Small packets must not grow just to carry a transport marker/instruction.
  if (projectedBytes + Buffer.byteLength(REVIEW_PACKET_PROJECTION_PROMPT_V7, "utf8") >= originalBytes)
    return { packet: structuredClone(value), projected: false, originalBytes, projectedBytes: originalBytes };
  if (JSON.stringify(expandReviewPacketV7(packet)) !== JSON.stringify(value)) throw new Error("review_projection_roundtrip_mismatch");
  return { packet, projected: true, originalBytes, projectedBytes };
}
