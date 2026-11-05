import Image from "next/image";
import { competitionGalleryImages } from "@/content/gallery";

export function ResourceGallery() {
  return (
    <section aria-labelledby="resource-gallery-title" className="mt-14 md:mt-16">
      <div className="flex flex-col gap-3 border-y border-border py-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.12em] text-brand-600">原图画廊</p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-[-0.025em] text-ink md:text-4xl" id="resource-gallery-title">
            项目成果一览
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">点击任意图片，在新窗口查看原始尺寸</p>
      </div>

      <div className="mt-8 columns-1 gap-6 sm:columns-2 lg:columns-3">
        {competitionGalleryImages.map((image, index) => (
          <article
            className="group relative mb-9 break-inside-avoid border-t border-border pt-4 transition-colors hover:border-brand-400"
            data-testid="competition-gallery-card"
            key={image.id}
          >
            <span aria-hidden="true" className="absolute right-0 top-4 text-[11px] font-semibold tracking-[0.2em] text-brand-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <a
              aria-label={`查看原图：${image.competition}，${image.title}`}
              className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500"
              href={image.src}
              rel="noopener noreferrer"
              target="_blank"
            >
              <div className="border border-border bg-white p-1">
                <Image
                  alt={image.alt}
                  className="h-auto w-full bg-white object-contain"
                  height={image.height}
                  loading={index === 0 ? undefined : "lazy"}
                  priority={index === 0}
                  sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                  src={image.src}
                  width={image.width}
                />
              </div>

              <div className="pb-1 pt-5">
                <p className="text-xs font-semibold leading-5 text-brand-600">{image.competition}</p>
                <h3 className="mt-2 text-base font-semibold leading-6 text-ink">{image.title}</h3>
                <div className="mt-4 flex items-center justify-between gap-3 border-y border-border py-3 text-xs text-muted-foreground">
                  <span>已脱敏</span>
                  <span>{image.formatLabel}</span>
                </div>
              </div>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
