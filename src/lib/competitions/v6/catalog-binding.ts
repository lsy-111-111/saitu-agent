import {createHash} from "node:crypto";
import {getDecisionCatalog} from "./catalog";
/** Same full-record fingerprint used by buildDecisionContext, read through the actual runtime loader. */
export function currentDecisionCatalogVersion(){return `v6-${createHash("sha256").update(JSON.stringify(getDecisionCatalog())).digest("hex").slice(0,24)}`;}
