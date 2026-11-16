export function inspectChallengeManifest(manifest: unknown): string[];
export function resolveRankingGold(matrix: unknown, gold: unknown, manifest: unknown, registeredAt: string): any[];
export function originalRankingAgreement(matrix: unknown, gold: unknown): any;
export function scoreRankingGate(matrix: unknown, gold: unknown, manifest: unknown, registeredAt: string, verification?: { verifiedOriginals?: unknown; bundle: unknown; registration: unknown }): any;
export function scoreEvaluationBundle(bundle: unknown, options: { frozenMatrix: unknown; registration: unknown; verifiedOriginals?: unknown }): any;
export function scorePerformance(samples: unknown[]): any;
