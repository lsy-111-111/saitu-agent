export function CompetitionTrustNotice() {
  return (
    <div className="flex gap-4 rounded-field border border-brand-200 bg-brand-50 p-5 text-sm leading-7 text-muted-foreground">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-200 text-brand-600"
      >
        <InfoIcon />
      </span>
      <div>
        <p className="font-semibold text-ink">提交前请核对官方通知</p>
        <p className="mt-1">
          报名时间、参赛资格、赛道与材料要求可能调整；本页用于筛选方向，最终以赛事官方页面和学校通知为准。
        </p>
      </div>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="12" cy="8" fill="currentColor" r="1" />
    </svg>
  );
}
