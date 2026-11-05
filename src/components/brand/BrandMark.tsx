import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  priority?: boolean;
  showWordmark?: boolean;
  size?: number;
};

export function BrandMark({
  className,
  priority = false,
  showWordmark = true,
  size = 36
}: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ height: size, width: size }}
      >
        <Image
          alt=""
          aria-hidden="true"
          height={size}
          priority={priority}
          src="/brand/saitu-mark-gradient.svg"
          width={size}
        />
      </span>
      {showWordmark ? (
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight sm:text-xl">
          <span className="font-serif text-ink">赛途</span>{" "}
          <span className="font-sans text-brand-500">Campus</span>
        </span>
      ) : null}
    </span>
  );
}
