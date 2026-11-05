"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmilyContactCard } from "@/components/about/EmilyContactCard";
import { groupCodeIsCurrent, groupExpiryLabel, teamGroups } from "@/content/community";

export function TeamGroups({ initialNow }: { initialNow: number }) {
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const current = Math.max(Date.now(), initialNow + performance.now() - started);
      setNow(current);
      const upcoming = teamGroups.map(group => Date.parse(group.expiresAt)).filter(expiry => expiry > current);
      if (upcoming.length) {
        // Browser timers accept at most a signed 32-bit delay.
        timer = setTimeout(refresh, Math.min(Math.ceil(Math.min(...upcoming) - current), 2_147_483_647));
      }
    }
    refresh();
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initialNow]);

  const hasCurrentCode = teamGroups.some((group) => groupCodeIsCurrent(group.expiresAt, now));

  return (
    <main className="mx-auto max-w-6xl px-5 pb-16 pt-10 md:px-8 md:pt-16">
      <header className="border-b border-border pb-8 md:pb-10">
        <p className="mb-3 text-sm font-semibold text-brand-600">竞赛组队</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-ink md:text-5xl">找一起参赛的队友</h1>
        <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
          {hasCurrentCode
            ? "选择想了解的群，用微信扫描二维码。手机上可以打开大图后保存，再用微信识别。"
            : "本批群二维码已过期。扫码添加 Emily 学姐，告诉她你想加入的群名，索取最新入口。"}
        </p>
        <Link className="mt-3 inline-block text-sm font-semibold text-brand-600 underline underline-offset-4" href="/about#contact">
          群满或二维码失效？联系 Emily 学姐
        </Link>
        {!hasCurrentCode && <div className="mt-5"><EmilyContactCard /></div>}
      </header>
      <ul className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {teamGroups.map((group) => (
          <li className="rounded-card border border-border bg-paper p-5" key={group.name}>
            <h2 className="text-lg font-semibold text-ink">{group.name}</h2>
            {groupCodeIsCurrent(group.expiresAt, now) ? (
              <>
                <a href={group.src} aria-label={`查看${group.name}二维码大图`} className="mx-auto my-5 block w-full max-w-56" target="_blank" rel="noopener noreferrer">
                  <Image alt={`${group.name}微信二维码`} width={224} height={224} className="h-auto w-full" src={group.src} unoptimized />
                </a>
                <p className="text-center text-sm text-muted-foreground">{groupExpiryLabel(group.expiresAt)}前有效</p>
              </>
            ) : (
              <div className="mt-4 border-t border-directory-divider pt-4 text-sm leading-7">
                <p className="text-muted-foreground">此群二维码已过期。</p>
                <Link className="font-semibold text-brand-600 underline underline-offset-4" href="/about#contact">联系学姐获取新码</Link>
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
