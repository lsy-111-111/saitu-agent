"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { competitions } from "@/content/competitions";

const competitionCount = competitions.length;

const entryCards = [
  {
    icon: "information",
    title: "竞赛信息",
    description: `汇总 ${competitionCount} 项竞赛信息，查看适合人群与准备建议`,
    href: "/competitions",
  },
  {
    icon: "teams",
    title: "竞赛组队",
    description: `扫码交流组队意向，寻找备赛伙伴`,
    href: "/teams",
  }
] as const;

function EntryIcon({ icon }: { icon: (typeof entryCards)[number]["icon"] }) {
  return (
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-white text-brand-700">
      {icon === "teams" ? (
        <svg fill="none" height="24" viewBox="0 0 32 32" width="24"><circle cx="12" cy="11" r="4.5" stroke="currentColor" strokeWidth="1.8" /><circle cx="22" cy="13" r="3.7" stroke="currentColor" strokeWidth="1.8" /><path d="M4 27c.7-5.8 3.7-8.6 8-8.6s7.3 2.8 8 8.6H4ZM18.3 26.9c-.1-2.5-.8-4.5-2.1-6.1 1.3-.9 2.9-1.4 4.8-1.4 3.8 0 6.5 2.5 7.2 7.5h-9.9Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /></svg>
      ) : (
        <svg fill="none" height="24" viewBox="0 0 32 32" width="24"><rect height="24" rx="3" stroke="currentColor" strokeWidth="1.8" width="20" x="6" y="4" /><path d="M12 10h8M12 16h8M12 22h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
      )}
    </span>
  );
}

export function CompetitionHeroSection() {
  const [isGreetingVisible, setGreetingVisible] = useState(false);

  return (
    <section className="overflow-hidden bg-white">
      <div className="relative isolate mx-auto grid min-h-[700px] max-w-[1512px] items-center gap-6 px-5 py-12 sm:px-7 md:py-16 lg:min-h-0 lg:grid-cols-[1.08fr_0.92fr] lg:px-20 lg:py-[42px]">
        <div className="relative z-20 max-w-3xl lg:translate-y-2 lg:py-12">
          <h1 className="max-w-3xl font-serif text-[clamp(2.65rem,5vw,4.75rem)] font-semibold leading-[1.1] tracking-[-0.04em] text-ink lg:max-w-[700px]">
            找到适合你、
            <span className="text-title-gradient mt-2 block">值得投入的第一场大学竞赛</span>
          </h1>
          <p className="mt-7 max-w-[620px] text-base leading-8 text-muted-foreground sm:text-lg">
            告诉乐乐你做过什么、喜欢做什么、想从比赛中得到什么。一起看看哪些比赛值得准备，以及你可以从哪一步开始。
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link className="inline-flex min-h-[60px] items-center justify-center rounded-button bg-brand-gradient px-10 text-base font-semibold text-white shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-lift motion-reduce:transform-none" href="/competitions/recommend">
              帮我选第一场竞赛<span aria-hidden="true" className="ml-2">→</span>
            </Link>
            <Link className="inline-flex min-h-[60px] items-center justify-center rounded-button border border-control-border bg-white px-10 text-base font-semibold text-ink transition duration-200 hover:-translate-y-0.5 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 motion-reduce:transform-none" href="/competitions/saved">
              我的竞赛
            </Link>
          </div>
          <div className="mt-10 flex max-w-[610px] flex-wrap gap-x-7 gap-y-3 border-t border-border pt-5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-cyan" />建议预留 4–6 分钟</span>
            <span className="inline-flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-cyan" />无需登录</span>
            <span className="inline-flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-cyan" />可随时修改回答</span>
          </div>
        </div>

        <div className="relative mx-auto min-h-[430px] w-full max-w-[620px] sm:min-h-[560px] lg:min-h-[650px] lg:translate-x-8">
          <button
            aria-label={isGreetingVisible ? "收起乐乐的问候" : "和乐乐打个招呼"}
            aria-pressed={isGreetingVisible}
            className="hero-character-stage group absolute inset-x-0 bottom-0 z-10 mx-auto h-[96%] w-fit cursor-pointer appearance-none border-0 bg-transparent p-0 focus-visible:rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 lg:bottom-6 lg:h-full"
            data-greeting={isGreetingVisible}
            onClick={() => setGreetingVisible((visible) => !visible)}
            type="button"
          >
            <span aria-hidden="true" className="hero-character-speech absolute left-1/2 top-[5%] z-20 -translate-x-[108%] whitespace-nowrap rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-800">
              嗨，一起看看吧。
            </span>
            <span className="hero-character-idle block h-full">
              <span className="hero-character-greeting block h-full">
              <Image alt="乐乐，一位手持平板、伸手欢迎的竞赛助手" className="h-full w-auto object-contain object-bottom" height={1264} priority sizes="(max-width: 639px) 88vw, (max-width: 1023px) 520px, 46vw" src="/brand/lele-cutout.png" width={878} />
              </span>
            </span>
          </button>
        </div>
      </div>

      <div className="border-t border-border bg-white">
        <div className="mx-auto max-w-[1512px] px-5 py-10 sm:px-7 lg:px-16 lg:py-0">
          <div className="grid border-y border-border md:grid-cols-2">
            {entryCards.map((card, index) => (
              <Link aria-label={`${card.title}：${card.description}`} className="group relative flex min-h-[156px] items-center gap-5 border-b border-border py-7 transition-colors hover:bg-brand-50/55 focus-visible:z-10 md:border-b-0 md:px-7 md:first:pl-0 md:last:pr-0 md:[&:not(:first-child)]:border-l" data-testid="home-entry-card" href={card.href} key={card.title}>
                <span aria-hidden="true" className="absolute right-3 top-4 text-[11px] font-semibold tracking-[0.2em] text-brand-400">0{index + 1}</span>
                <EntryIcon icon={card.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-2xl font-semibold text-ink">{card.title}</span>
                  <span className="mt-2 block text-sm leading-6 text-muted-foreground">{card.description}</span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-xl text-brand-700 transition-transform group-hover:translate-x-1 motion-reduce:transform-none">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
