import { HalfBodyPortrait } from "@/components/brand/HalfBodyPortrait";

export function CompetitionPageHero() {
  return (
    <section aria-labelledby="competition-page-title">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-12">
        <div className="max-w-4xl">
          <h1
            className="max-w-4xl font-serif text-[2.7rem] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-5xl md:text-[3.15rem] lg:text-[3.35rem]"
            id="competition-page-title"
          >
            找到适合你的大学生竞赛入口
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">
            按方向浏览创新创业、科技工程、职业规划、数字媒体、人工智能与机械设计等赛事，先判断是否适合，再进入官方页面核验报名要求。
          </p>
        </div>

        <HalfBodyPortrait
          alt="乐乐手持资料夹介绍竞赛目录"
          className="mx-auto w-[220px] justify-self-center sm:w-[250px] lg:mx-0 lg:w-[300px] lg:justify-self-end xl:w-[320px]"
          imageClassName="scale-[2.15] object-[48%_0%]"
          priority
          sizes="(min-width: 1280px) 320px, (min-width: 1024px) 300px, (min-width: 640px) 250px, 220px"
          src="/brand/lele-competitions.png"
        />
      </div>
    </section>
  );
}
