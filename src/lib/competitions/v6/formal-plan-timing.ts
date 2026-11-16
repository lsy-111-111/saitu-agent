import { z } from "zod";
import type { DecisionCompetitionRecord } from "./catalog-types";

const text = z.string().trim().min(1);
const refs = z.array(text).min(1).refine(ids => new Set(ids).size === ids.length);
/** Precision is published precision; offsets describe the official locality, never inferred from the viewer. */
export const publishedPlanDateSchema = z.object({ value: text, precision: z.enum(["day", "month", "instant"]), utcOffsetMinutes: z.number().int().min(-840).max(840) }).strict().refine(v => publishedDateBounds(v) !== null);
export type PublishedPlanDate = { value: string; precision: "day" | "month" | "instant"; utcOffsetMinutes: number };
export function publishedDateBounds(v: PublishedPlanDate): { earliest: number; latest: number } | null {
  if (!Number.isInteger(v.utcOffsetMinutes) || Math.abs(v.utcOffsetMinutes) > 840) return null;
  if (v.precision === "instant") {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v.value);
    if (!parts) return null;
    const [, year, month, day, hour, minute, second, fraction, zone, sign, offsetHour, offsetMinute] = parts;
    const minutes = zone === "Z" ? 0 : (sign === "-" ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute));
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone !== "Z" && (Number(offsetHour) > 14 || Number(offsetMinute) > 59 || Math.abs(minutes) > 840)) || minutes !== v.utcOffsetMinutes) return null;
    // Parse the local calendar independently: Date.parse otherwise normalizes November 31.
    const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${(fraction ?? "").padEnd(3, "0")}`;
    const localTime = Date.parse(local + "Z");
    if (!Number.isFinite(localTime) || new Date(localTime).toISOString() !== local + "Z") return null;
    const t = localTime - minutes * 60000;
    return { earliest: t, latest: t };
  }
  if (!(v.precision === "day" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(v.value)) return null;
  const start = v.precision === "month" ? v.value + "-01" : v.value;
  const parsed = Date.parse(start + "T00:00:00Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== start) return null;
  const d = new Date(parsed); if (v.precision === "month") d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCDate(d.getUTCDate() + 1);
  return { earliest: parsed - v.utcOffsetMinutes * 60000, latest: d.getTime() - v.utcOffsetMinutes * 60000 - 1 };
}
export const formalPlanTimingSchema = z.object({ editionId: text, rulesFactIds: refs, registrationFactIds: refs, scheduleFactIds: refs,
  registrationOpens: publishedPlanDateSchema.nullable(), registrationCloses: publishedPlanDateSchema.nullable(),
  stages: z.array(z.object({ stageId: text, starts: publishedPlanDateSchema.nullable(), ends: publishedPlanDateSchema.nullable() }).strict()).min(1),
}).strict();
export type FormalPlanTiming = z.infer<typeof formalPlanTimingSchema>;
/** Pure time comparison; official applicability and review are verified by the enclosing plan contract. */
export function assessFormalPlanTiming(record: DecisionCompetitionRecord, timing: FormalPlanTiming, stageIds: string[], weekStarts: string[], now: Date): string[] {
  if (!Number.isFinite(now.getTime())) return ["invalid_assessment_time"];
  const reasons: string[] = [];
  if (!record.identity || record.identity.editionId !== timing.editionId) reasons.push("formal_edition_identity_mismatch");
  if (["historical", "closed"].includes(record.registration.status)) reasons.push("formal_entry_closed_or_historical");
  const open = timing.registrationOpens && publishedDateBounds(timing.registrationOpens);
  const close = timing.registrationCloses && publishedDateBounds(timing.registrationCloses);
  if (!open || !close) reasons.push("published_registration_window_unknown");
  else {
    if (open.latest >= close.earliest) reasons.push("published_registration_window_invalid");
    // If a deadline is only known to a day/month, stop counting at its earliest possible boundary.
    if (now.getTime() >= close.earliest) reasons.push("registration_deadline_passed_or_precision_insufficient");
  }
  if (new Set(timing.stages.map(s => s.stageId)).size !== timing.stages.length || timing.stages.length !== stageIds.length || timing.stages.some(s => !stageIds.includes(s.stageId))) reasons.push("formal_schedule_stage_mismatch");
  for (const s of timing.stages) {
    const start = s.starts && publishedDateBounds(s.starts), end = s.ends && publishedDateBounds(s.ends);
    if (!start || !end) reasons.push("published_stage_schedule_unknown");
    else {
      if (start.earliest > end.latest || now.getTime() >= end.earliest) reasons.push("formal_stage_ended_or_schedule_invalid");
      // No profile has confirmed prior entry. Preparation may precede registration,
      // but actual entry must be possible before every mandatory delivery deadline.
      if (open && Math.max(now.getTime(), open.latest) > end.earliest) reasons.push("registration_entry_after_required_stage");
    }
  }
  const thisWeek = new Date(now); thisWeek.setUTCHours(0, 0, 0, 0); thisWeek.setUTCDate(thisWeek.getUTCDate() - (thisWeek.getUTCDay() + 6) % 7);
  if (weekStarts.some(w => Date.parse(w) < thisWeek.getTime())) reasons.push("past_work_not_confirmed_complete");
  return [...new Set(reasons)];
}
