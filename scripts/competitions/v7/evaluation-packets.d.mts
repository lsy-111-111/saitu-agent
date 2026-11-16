export function sanitizeRankingCandidate(record: any, predicate: (record: any, fact: any) => boolean): any;
export function buildRankingPackets(options: any): any;
export function buildAdjudicationPacket(options: any): any;
export function inspectCompleteBlindOriginals(options: any): any;
export function validateCompleteReviewerProvenance<T>(original: T, options?: { blockedContextIds?: string[] }): T;
