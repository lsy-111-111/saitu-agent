import Image from "next/image";
import { EmilyContactCard } from "@/components/about/EmilyContactCard";
import { competitionGalleryImages } from "@/content/gallery";

const awardGroups = [
  {
    title: "参赛作品与团队获奖",
    records: competitionGalleryImages.filter((image) => image.id !== 75 && image.id !== 86)
  },
  { title: "指导教师荣誉", records: competitionGalleryImages.filter((image) => image.id === 75) },
  { title: "聘任经历", records: competitionGalleryImages.filter((image) => image.id === 86) }
];

export function AboutPageContent() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 md:px-8">
      <section
        id="contact"
        aria-labelledby="contact-heading"
        className="grid gap-8 border-b border-border py-10 sm:grid-cols-[1fr_auto] sm:items-center md:gap-14 md:py-16"
      >
        <div>
          <p className="mb-3 text-sm font-semibold text-brand-600">关于我们 · 联系赛途</p>
          <h1
            id="contact-heading"
            className="font-serif text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl"
          >
            想把一场竞赛了解得更深？
          </h1>
          <p className="mt-5 max-w-xl leading-8 text-muted-foreground">
            已经有想参加的比赛了？如果你还拿不准选哪个赛道、怎么找队友，或第一步准备什么，可以联系 Emily
            学姐聊聊。
          </p>
        </div>
        <EmilyContactCard />
      </section>
      <section id="certificates" aria-labelledby="certificates-heading" className="pt-10 md:pt-14">
        <h2 id="certificates-heading" className="font-serif text-3xl font-semibold text-ink md:text-4xl">
          团队竞赛经历与荣誉
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          共 17 份获奖证明及 1 份聘书。参赛队员、项目成员和指导教师的角色以各张证书为准。点击可看大图。
        </p>
        {awardGroups.map((group) => (
          <section key={group.title} className="mt-9">
            <h3 className="text-xl font-semibold text-ink">{group.title}</h3>
            <ul className="mt-4 grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {group.records.map((image) => (
                <li key={image.id} data-testid="competition-gallery-card">
                  <a
                    href={image.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`查看${image.alt}`}
                    className="group block"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-border bg-surface transition-colors group-hover:border-brand-400">
                      <Image
                        alt={image.alt}
                        className="object-contain p-3"
                        src={image.src}
                        fill
                        sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
                      />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-brand-600">{image.competition}</p>
                    <h4 className="mt-1 text-lg font-semibold text-ink">{image.title}</h4>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </div>
  );
}
