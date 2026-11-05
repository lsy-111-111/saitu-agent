import { HalfBodyPortrait } from "@/components/brand/HalfBodyPortrait";

type DirectoryPageHeroProps = {
  characterSrc: string;
  description: string;
  pose: "resources" | "teams";
  title: string;
};

export function DirectoryPageHero({ characterSrc, description, pose, title }: DirectoryPageHeroProps) {
  return (
    <section
      aria-labelledby="directory-page-title"
      className="grid items-center gap-8 bg-white pb-0 pt-10 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10 lg:pt-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-12"
    >
      <div className="max-w-2xl">
        <h1
          className="font-serif text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.04em] text-ink sm:text-5xl lg:text-[3.55rem]"
          id="directory-page-title"
        >
          {title}
        </h1>
        <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
          {description}
        </p>
      </div>

      <div
        className="flex items-center justify-center lg:justify-end"
        data-pose={pose}
      >
        <HalfBodyPortrait
          alt={pose === "resources" ? "乐乐手持资料夹介绍竞赛资源" : "乐乐展示竞赛组队入口"}
          className="w-[220px] sm:w-[250px] lg:w-[300px] xl:w-[320px]"
          imageClassName={pose === "resources" ? "scale-[2.08] object-[49%_0%]" : "scale-[2.08] object-[50%_0%]"}
          priority
          sizes="(min-width: 1280px) 320px, (min-width: 1024px) 300px, (min-width: 640px) 250px, 220px"
          src={characterSrc}
        />
      </div>
    </section>
  );
}
