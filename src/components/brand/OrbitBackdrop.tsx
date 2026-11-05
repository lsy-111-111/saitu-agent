import { cn } from "@/lib/utils";

type OrbitBackdropProps = {
  className?: string;
  compact?: boolean;
};

export function OrbitBackdrop({ className, compact = false }: OrbitBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div className="absolute inset-[10%] rounded-full bg-violet/15 blur-3xl max-sm:hidden" />
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 0 640 520"
      >
        <defs>
          <linearGradient id="orbit-backdrop-spectrum" x1="70" y1="80" x2="576" y2="438" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3730A3" />
            <stop offset="0.32" stopColor="#4338CA" />
            <stop offset="0.63" stopColor="#6366F1" />
            <stop offset="1" stopColor="#06B6D4" />
          </linearGradient>
        </defs>
        <g className="animate-orbit-drift origin-center opacity-55">
          <ellipse cx="320" cy="270" rx="258" ry="112" stroke="url(#orbit-backdrop-spectrum)" strokeWidth="1.5" transform="rotate(-13 320 270)" />
        </g>
        <g className="animate-orbit-drift-reverse origin-center opacity-40 max-sm:hidden">
          <ellipse cx="320" cy="260" rx="210" ry="160" stroke="url(#orbit-backdrop-spectrum)" strokeWidth="1.25" transform="rotate(24 320 260)" />
        </g>
        <circle className="animate-star-breathe" cx="566" cy="220" fill="#06B6D4" r="4" />
        {!compact ? (
          <>
            <circle className="animate-star-breathe [animation-delay:1.4s]" cx="124" cy="376" fill="#6366F1" r="3.5" />
            <path className="animate-star-breathe [animation-delay:2.2s]" d="M517 94c1.5 9.4 6.2 14.1 15.6 15.6-9.4 1.5-14.1 6.2-15.6 15.6-1.5-9.4-6.2-14.1-15.6-15.6 9.4-1.5 14.1-6.2 15.6-15.6Z" fill="#F59E0B" />
          </>
        ) : null}
      </svg>
    </div>
  );
}
