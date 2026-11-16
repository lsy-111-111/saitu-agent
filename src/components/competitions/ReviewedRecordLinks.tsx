import Link from "next/link";
import { decisionRecordHref } from "@/lib/competitions/v6/public-catalog";
import type { DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";

type RecordLink = Pick<DecisionCompetitionRecord, "recordId" | "edition" | "track" | "scope" | "contentTier">;

export function ReviewedRecordLinks({ records }: { records: readonly RecordLink[] }) {
  if (!records.length) return null;
  return <section className="my-6 rounded-2xl border border-brand-200 bg-brand-50/40 p-5" data-testid="reviewed-record-links">
    <h2 className="text-lg font-semibold">按届次和任务阅读</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">下面的资料已完成内容核对。请分别看清适用范围；往届案例可以帮助准备，不能据此认定当前可报名。</p>
    <ul className="mt-4 space-y-3">
      {records.map(record => <li key={record.recordId}>
        <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-4" href={decisionRecordHref(record.recordId)}>
          {record.edition} · {record.track.name}{record.contentTier === "L3" ? " · 含具体案例" : ""}
        </Link>
        <p className="text-sm leading-6 text-muted-foreground">{record.scope}</p>
      </li>)}
    </ul>
  </section>;
}
