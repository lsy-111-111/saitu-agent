import "server-only";
import {AsyncLocalStorage} from "node:async_hooks";
const limits=new AsyncLocalStorage<number>();
const reservationLimits=new AsyncLocalStorage<number>();
/** Server-only fault scope can only lower the effective cap; it cannot choose/create another run. */
export function withAiSpendLimit<T>(micros:number,work:()=>T):T{if(!Number.isSafeInteger(micros)||micros<0)throw new Error("invalid_spend_limit");return limits.run(Math.min(micros,limits.getStore()??Infinity),work);}
export function scopedAiSpendLimitMicros(){return limits.getStore();}

/** Additional per-reservation ceiling. This does not replace or increase the
 * funded run's cumulative cap, and nested scopes may only tighten it. */
export function withAiReservationLimit<T>(micros:number,work:()=>T):T{
  if(!Number.isSafeInteger(micros)||micros<0)throw new Error("invalid_reservation_limit");
  return reservationLimits.run(Math.min(micros,reservationLimits.getStore()??Infinity),work);
}
export function scopedAiReservationLimitMicros(){return reservationLimits.getStore();}
