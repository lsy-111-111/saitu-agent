export const METHODS: Readonly<Record<string, string>>;
export function canonicalJson(value: unknown): string;
export function canonicalHash(value: unknown): string;
export function deriveRunSeed(seed: number, profileId: string, repetition: number): number;
export function seededShuffle<T>(values: T[], seed: number): T[];
export function generationStatus(report: unknown, requestedMethod: string): string;
export function summarizeBoundRuns(observations: unknown[]): any;
export function executeFrozenRanking(options: any): Promise<any>;
export function validateReusableRanking(options: any): any;
