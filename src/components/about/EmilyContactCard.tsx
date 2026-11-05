import Image from "next/image";
import { emilyQr } from "@/content/community";

export function EmilyContactCard() {
  return (
    <figure className="w-fit rounded-card border border-border bg-white px-4 pb-4 pt-2 text-center">
      <a href={emilyQr} target="_blank" rel="noopener noreferrer" aria-label="打开 Emily 学姐微信二维码大图" className="block">
        <Image alt="Emily 学姐个人微信二维码" width={196} height={196} src={emilyQr} unoptimized priority />
      </a>
      <figcaption className="text-sm font-semibold text-ink">Emily 学姐 · 微信</figcaption>
    </figure>
  );
}
