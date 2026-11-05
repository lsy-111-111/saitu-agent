import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div className={cn("rounded-card border border-border bg-card p-5 shadow-soft", className)} {...props}>
      {children}
    </div>
  );
}
