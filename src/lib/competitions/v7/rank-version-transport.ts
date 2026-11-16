import { createHash } from "node:crypto";

type RankHeaders = { profileRevision: string; catalogVersion: string };
const fields = ["profileRevision", "catalogVersion"] as const;
const staleIssue = { profileRevision: "stale_profile_revision", catalogVersion: "stale_catalog_version" };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Compact only the structural echo fields. The full digest remains in the
 * request so its existing durable hash binds the complete versions. */
export function createRankVersionTransportV7(headers: RankHeaders, binding: { promptVersion: string; effortPolicySha256: string; repair: boolean }) {
  const expected = { ...headers };
  const rankVersionBindingSha256 = createHash("sha256").update(JSON.stringify([
    "saitu.rank-version-transport.v1", expected.profileRevision, expected.catalogVersion,
    binding.promptVersion, binding.effortPolicySha256, binding.repair,
  ])).digest("hex");
  const aliases = { profileRevision: `RP${rankVersionBindingSha256.slice(0, 8)}`, catalogVersion: `RC${rankVersionBindingSha256.slice(8, 16)}` };
  const encodeHeaders = (value: unknown) => {
    if (!object(value) || fields.some(field => value[field] !== expected[field])) throw new Error("rank_version_request_binding_changed");
    return { ...value, ...aliases };
  };
  return {
    encodeRequest(payload: unknown, envelopeRepair: boolean): unknown {
      if (!object(payload)) throw new Error("invalid_rank_version_request");
      if (envelopeRepair) return { ...payload, expectedHeaders: encodeHeaders(payload.expectedHeaders), rankVersionBindingSha256 };
      const profile = payload.profile;
      if (!object(profile) || profile.revision !== expected.profileRevision) throw new Error("rank_version_request_profile_changed");
      return { ...encodeHeaders(payload), profile: { ...profile, revision: aliases.profileRevision },
        outputFormat: encodeHeaders(payload.outputFormat), rankVersionBindingSha256 };
    },
    decodeResponse(value: unknown): { value: unknown; issues: string[] } {
      if (!object(value)) return { value, issues: [] };
      const decoded = { ...value }, issues: string[] = [];
      for (const field of fields) {
        if (!Object.hasOwn(value, field)) continue;
        if (value[field] === aliases[field]) decoded[field] = expected[field];
        else issues.push(staleIssue[field]);
      }
      // Leave omissions absent for schema validation and the existing
      // strictly authenticated, body-preserving envelope repair.
      return { value: decoded, issues };
    },
  };
}
