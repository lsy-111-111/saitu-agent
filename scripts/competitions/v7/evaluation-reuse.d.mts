export function inspectFreezeBinding(binding: unknown): void;
export function validateBoundObservation(observation: unknown, ranking: unknown, profile: unknown, binding: unknown, seed: number, runtime?: any): any;
export function validateFrozenMatrix(matrix: unknown): any;
export function createCReuse(matrix: unknown): { counts: any; size: number; algorithm: string; additionalPaidRuns: number; get(input: { caseId: string; repetition: number; input: unknown }): any };
export function loadRankingReuse(options: { directory: string; freezeManifestSha256: string; expectedBinding: unknown }): Promise<any>;
export function isVerifiedRankingReuse(value: any): boolean;
