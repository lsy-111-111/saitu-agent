export const site = {
  siteName: "赛途 Campus",
  siteDescription: "赛途帮助大学生竞赛新手根据自己的能力、经历和目标，选出值得准备的比赛。",
  defaultTitle: "赛途｜找到适合你、值得投入的第一场大学竞赛",
  defaultDescription:
    "告诉乐乐你喜欢的任务、做过的项目和期待的收获，了解哪些竞赛值得投入，为什么适合，以及怎样开始。",
  primaryCTA: "帮我选第一场竞赛",
  secondaryCTA: "浏览竞赛信息",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "privacy@siyuanjiaxin.com",
  seoBaseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://siyuanjiaxin.com",
  icpRecord: {
    label: process.env.NEXT_PUBLIC_ICP_LABEL ?? "粤ICP备2026075903号",
    href: "https://beian.miit.gov.cn/"
  },
  policeRecord: {
    // 公安联网备案号下来后，用环境变量填入即可在页脚自动展示（含警徽图标）；为空时不展示。
    label: process.env.NEXT_PUBLIC_POLICE_LABEL ?? "",
    code: process.env.NEXT_PUBLIC_POLICE_CODE ?? "",
    href: "https://beian.mps.gov.cn/#/query/webSearch"
  },
  legalLinks: [
    { label: "隐私政策", href: "/privacy" },
    { label: "用户协议", href: "/terms" }
  ],
  placeholders: {
    brandNotice:
      "竞赛信息整理自赛事官方公开渠道；具体赛程、资格与报名要求请以官方公告为准。"
  }
} as const;

export type SiteConfig = typeof site;
