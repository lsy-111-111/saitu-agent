import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
export type EvidenceRegistryLocation={root:string;index:string;indexSha256:string};
const registry=new AsyncLocalStorage<EvidenceRegistryLocation>();
/** Server-side administrative/evaluation scope only; never populated from a chat request body. */
export function withEvidenceRegistry<T>(location:EvidenceRegistryLocation,work:()=>T):T{return registry.run(location,work);}
export function evidenceRegistryLocation(){return registry.getStore();}
