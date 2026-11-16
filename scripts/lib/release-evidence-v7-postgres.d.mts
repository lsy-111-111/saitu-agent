export const V7_NATIVE_ASSERTIONS: readonly string[];
export const V7_NATIVE_LEGACY_ASSERTIONS: readonly string[];
export const V7_NATIVE_EFFORT_ASSERTIONS: readonly string[];
export const V7_NATIVE_TOP5_ASSERTIONS: readonly string[];
export type NativeV7PostgresResult = {
  schemaVersion: string;
  status: string;
  database: string;
  postgresVersion: string;
  observations: string[];
  productionGrantChain: {
    syntheticGrantInDisposableDatabase: boolean;
    phase: string;
    configuredCalibrationCallLimit: number;
    authoritativePgCallLimit: number;
    authorizedReservations: number;
    chargedMicros: number;
    providerDispatches: number;
    configurationOnlyNextSeal: boolean;
  };
  stageGrantChain?: { syntheticGrantInDisposableDatabase: boolean; grantVersion: string; effortPolicySha256: string; rankEffort: string; authorizedReservations: number; chargedMicros: number; providerDispatches: number; configurationOnlyNextSeal: boolean };
  top5GrantChain?: { syntheticGrantInDisposableDatabase: boolean; grantVersion: string; effortPolicySha256: string; rankEffort: string; authorizedReservations: number; chargedMicros: number; providerDispatches: number; configurationOnlyNextSeal: boolean };
  userUnboundedGrantChain?: {syntheticGrantInDisposableDatabase:boolean;grantVersion:string;executionMode:string;effortPolicySha256:string;rankEffort:string;authorizedReservations:number;chargedMicros:number;providerDispatches:number;configurationOnlyNextSeal:boolean;physicalUnknownHoldRejected:boolean};
  workerBuild: { sourceSha256: string; artifactSha256: string; effortPolicySha256?: string; executionMode?:string };
  paidCalls: number;
  productionTouched: boolean;
};
export function validateNativeV7PostgresResult(result: unknown): NativeV7PostgresResult;
export function runNativeV7Postgres(input: { root: string; output: string }): Promise<NativeV7PostgresResult & {
  execution: { platform: string; arch: string; node: string; source: string; sourceSha256: string; rawLogSha256: string };
}>;
