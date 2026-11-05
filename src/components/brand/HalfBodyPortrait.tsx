import Image from "next/image";
import { cn } from "@/lib/utils";

type HalfBodyPortraitProps = {
  alt: string;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
  sizes: string;
  src: string;
};

export function HalfBodyPortrait({
  alt,
  className,
  imageClassName,
  priority = false,
  sizes,
  src
}: HalfBodyPortraitProps) {
  return (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-full border-[5px] border-brand-800 bg-white p-1 shadow-soft",
        className
      )}
      data-testid="lele-half-body-portrait"
    >
      <div className="relative h-full w-full overflow-hidden rounded-full border-2 border-warm-accent bg-white">
        <Image
          alt={alt}
          className={cn(
            "origin-top object-contain object-top",
            imageClassName ?? "scale-[2.08]"
          )}
          fill
          priority={priority}
          sizes={sizes}
          src={src}
        />
      </div>
    </div>
  );
}
