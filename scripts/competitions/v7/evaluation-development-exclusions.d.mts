export const DEVELOPMENT_CONSUMER_VERSION: string;
export const CALIBRATION_DEVELOPMENT_CONSUMER_VERSION: string;
export const UNKNOWN_TEMPLATE_CONTRACT: string;
export function hasVersionedUnknownTemplateContract(manifest: any): boolean;
export function validateDevelopmentConsumerContract(config: any): any;
export function readPublicEvaluationJson(evidenceRoot: string, reference: any): Promise<any>;
export function verifyPublicCalibrationDevelopmentDelta(options: { evidenceRoot: string; publicDevelopmentManifest: { path: string; sha256: string; bytes?: number }; forbiddenContextIds?: string[] }): Promise<any>;
export function verifyDevelopmentExclusions(options: { evidenceRoot: string; manifest: any; config: any; migration: any; sourceDependencies?: any; registeredAt: string }): Promise<any>;
