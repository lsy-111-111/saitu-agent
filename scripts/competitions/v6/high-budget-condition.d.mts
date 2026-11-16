import type {Client,PoolClient} from 'pg';
export const HIGH_CONDITION_INPUTS:Readonly<{directory:string;auditSha256:string;coordinationPath:string;coordinationSha256:string}>;
export interface MaxFailureBudgetCondition {
 schemaVersion:'saitu.max-failure-budget-condition.v1';initialEffort:'max';nextPermittedEffort:'high';
 sourceRunId:string;sourceBatchId:string;auditSha256:string;coordinationSha256:string;rawManifestSha256:string;
 registeredPages:number;executedPages:number;successfulPages:number;candidateCount:number;distinctCandidateOrders:number;
 processConcurrency:number;providerHttp:number;accountedMicros:string;freshPgRowsVerified:boolean;freshPgRowSha256:string;
 freshReservationIds:string[];pages:Array<{id:string;passed:boolean;requestId:string;dispatches:number;candidateOrderSha256:string}>;
}
export function verifyHighBudgetCondition(client:Client|PoolClient,root:string):Promise<MaxFailureBudgetCondition>;
