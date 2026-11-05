import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  narrow?: boolean;
  wide?: boolean;
};

export function Section({ children, className, narrow = false, wide = false, ...props }: SectionProps) {
  return (
    <section className={cn("px-5 py-14 md:py-24", className)} {...props}>
      <div className={cn("mx-auto w-full", narrow ? "max-w-3xl" : wide ? "max-w-[1512px]" : "max-w-6xl")}>{children}</div>
    </section>
  );
}
