import { cn } from "@/lib/utils";

type GradientProgressProps = {
  className?: string;
  label?: string;
  value: number;
};

export function GradientProgress({ className, label = "完成进度", value }: GradientProgressProps) {
  const normalizedValue = Math.min(100, Math.max(0, value));

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(normalizedValue)}
      className={cn("h-1.5 rounded-full bg-brand-100", className)}
      role="progressbar"
    >
      <div
        className="relative h-full rounded-full bg-orbit-gradient"
        style={{ width: `${normalizedValue}%` }}
      >
        {normalizedValue > 0 ? (
          <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white bg-cyan shadow-[0_0_0_3px_rgba(6,182,212,0.12)]" />
        ) : null}
      </div>
    </div>
  );
}
