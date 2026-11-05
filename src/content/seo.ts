import { site } from "./site";

export const seo = {
  default: {
    title: site.defaultTitle,
    description: site.defaultDescription,
    canonical: "/"
  },
  pages: {
    home: {
      title: site.defaultTitle,
      description: site.defaultDescription,
      canonical: "/",
      index: true
    },
    competitions: {
      title: "大学生竞赛信息库｜创新创业、科技工程、职业规划竞赛",
      description:
        "整理适合大学生关注的竞赛信息，包含创新创业、学术科研、语言人文、数字媒体、人工智能与工程制造等方向。",
      canonical: "/competitions",
      index: true
    },
    competitionRecommend: {
      title: "智能竞赛助手｜赛途 Campus",
      description: "通过结构化问答，让赛途 Campus 竞赛助手从已收录的竞赛中找到更适合你的参赛方向。",
      canonical: "/competitions/recommend",
      index: false
    },
    teams: {
      title: "大学生竞赛组队｜赛途 Campus",
      description: "查看赛途竞赛组队二维码，交流组队意向。",
      canonical: "/teams",
      index: false
    },
    about: {
      title: "关于我们｜赛途 Campus",
      description: "浏览团队竞赛证书，联系 Emily 学姐进一步了解备赛。",
      canonical: "/about",
      index: true
    },
    privacy: {
      title: "隐私政策",
      description: "了解竞赛助手问答、AI 调用、竞赛资料、外部链接和数据删除方式。",
      canonical: "/privacy",
      index: true
    },
    terms: {
      title: "用户协议",
      description: "了解竞赛目录、组队入口和智能竞赛助手服务的使用规则与责任边界。",
      canonical: "/terms",
      index: true
    }
  },
  noindexRoutes: ["/competitions/recommend", "/teams"],
  robotsDisallowRoutes: ["/api/"]
} as const;
