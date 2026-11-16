import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { calibrationCallLimit } from "@/lib/ai/spend-ledger";
import { acceptanceCanonicalHash, validatePublicRuntimeConfiguration } from "../../scripts/competitions/v6/acceptance-artifact-derivation";
const { runtimeConfiguration } = createRequire(import.meta.url)("../../scripts/competitions/v6/runtime-configuration.mjs") as {
  runtimeConfiguration: (environment: Record<string, string>) => {schemaVersion: string; values: Record<string, string | null>};
};
describe("operator calibration cap only lowers existing authority", () => {
  it("keeps default 100 and permits lower positive integer caps", () => {
    expect(calibrationCallLimit(undefined)).toBe(100);
    expect(calibrationCallLimit("")).toBe(100);
    expect(calibrationCallLimit("98")).toBe(98);
    expect(calibrationCallLimit("1")).toBe(1);
    for (const value of ["101", "0", "-1", "1.5", "NaN", "001", "Infinity"]) expect(calibrationCallLimit(value)).toBeNull();
  });
  it("freezes the effective new control and rejects attempted ceiling increases", () => {
    expect(runtimeConfiguration({}).values.AI_CALIBRATION_CALL_LIMIT).toBe("100");
    expect(runtimeConfiguration({ AI_CALIBRATION_CALL_LIMIT: "98" }).values.AI_CALIBRATION_CALL_LIMIT).toBe("98");
    expect(() => runtimeConfiguration({ AI_CALIBRATION_CALL_LIMIT: "101" })).toThrow("can_only_lower");
  });
  it("accepts old v1 bytes without the field as default 100 without changing their hash", () => {
    const legacy = runtimeConfiguration({});
    delete legacy.values.AI_CALIBRATION_CALL_LIMIT;
    const before = JSON.stringify(legacy), hash = acceptanceCanonicalHash(legacy);
    validatePublicRuntimeConfiguration(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(acceptanceCanonicalHash(legacy)).toBe(hash);
    const current = runtimeConfiguration({ AI_CALIBRATION_CALL_LIMIT: "98" });
    validatePublicRuntimeConfiguration(current);
    expect(() => validatePublicRuntimeConfiguration({ ...current, values: { ...current.values, AI_CALIBRATION_CALL_LIMIT: "101" } })).toThrow("runtime_calibration_call_limit_invalid");
    expect(() => validatePublicRuntimeConfiguration({ ...current, values: { ...current.values, SECRET: "not-allowed" } })).toThrow("runtime_configuration_public_contract_invalid");
  });
});
