import Image from "next/image";
import Link from "next/link";
import { competitionGalleryImages } from "@/content/gallery";

const featuredImages = competitionGalleryImages.slice(0, 3);

export function ResourcePageHero() {
  return (
    <section aria-labelledby="resource-page-title" className="relative overflow-hidden rounded-[28px] border border-border bg-card px-5 py-10 shadow-soft sm:px-8 md:px-10 md:py-12 lg:px-12">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-violet/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-1/4 h-64 w-64 rounded-full bg-cyan/10 blur-3xl" />
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-[linear-gradient(90deg,#3730A3_0%,#4338CA_32%,#6366F1_61%,#06B6D4_100%)]" />
      <div className="grid items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-8">
        <div className="relative z-10 max-w-xl">
          <p className="text-sm font-semibold tracking-[0.12em] text-brand-600">竞赛资源</p>
          <h1 className="mt-5 font-serif text-[2.7rem] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-5xl lg:text-[3.8rem]" id="resource-page-title">
            集中查看竞赛成果与证书图片
          </h1>
          <p className="mt-6 max-w-lg text-base leading-8 text-muted-foreground md:text-lg">
            当前收录 {competitionGalleryImages.length} 张项目成果与证书图片，保留原图比例，并使用图片中可核对的赛事与奖项信息标注。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className="inline-flex min-h-12 items-center justify-center rounded-button bg-[linear-gradient(135deg,#3730A3_0%,#4338CA_100%)] px-6 text-sm font-semibold text-white shadow-action transition duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500 motion-reduce:transform-none motion-reduce:transition-none" href="/competitions">
              查看竞赛信息 <span aria-hidden="true" className="ml-2">→</span>
            </Link>
            <Link className="inline-flex min-h-12 items-center justify-center rounded-button border border-control-border bg-white px-6 text-sm font-semibold text-ink transition duration-200 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500" href="/competitions/recommend">
              打开竞赛助手
            </Link>
          </div>
          <div className="mt-8 inline-flex items-end gap-3 border-l-2 border-brand-500 pl-4">
            <span className="font-serif text-4xl leading-none text-ink">{competitionGalleryImages.length}</span>
            <span className="pb-0.5 text-sm text-muted-foreground">张真实成果与证书图片</span>
          </div>
        </div>

        <div className="relative mx-auto h-[330px] w-full max-w-[650px] sm:h-[430px]">
          <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[82%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-200/70 bg-brand-50/60" />
          <div aria-hidden="true" className="absolute right-[7%] top-[3%] text-3xl text-warm-accent">✦</div>
          <div aria-hidden="true" className="absolute left-[3%] top-[24%] h-2.5 w-2.5 rotate-45 border-2 border-cyan" />
          <div className="relative z-10 grid h-full grid-cols-3 items-center gap-3 px-2 sm:gap-5 sm:px-4">
            {featuredImages.map((image, index) => (
              <div
                className={[
                  "overflow-hidden rounded-card border border-border bg-white p-2.5 shadow-lift",
                  index === 0 ? "h-[76%]" : "",
                  index === 1 ? "h-[88%]" : "",
                  index === 2 ? "h-[72%]" : ""
                ].join(" ")}
                key={image.id}
              >
                <div className="relative h-full w-full overflow-hidden rounded-field bg-white">
                  <Image alt={image.alt} className="object-contain object-center" fill priority={index === 0} sizes="(min-width: 1024px) 210px, 30vw" src={image.src} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
