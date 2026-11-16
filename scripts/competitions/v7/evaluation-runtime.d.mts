export const V7_GRANT_VERSION: string;
export function runtimeBehaviorConfiguration(environment?: Record<string, string | undefined>): any;
export function runtimeBehaviorConfigurationHash(environment?: Record<string, string | undefined>): string;
export function validateExecutionScope<T>(scope: T, options: { allowedPhases: string[]; allowRankNonThinking?: boolean }): T;
