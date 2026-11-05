import type {
  ResolvedCompetitionResource,
  ResolvedCompetitionTeamAvailability
} from "@/lib/competitions/service-resolver";

type StatusPresentation = {
  dotClassName: string;
  label: string;
  textClassName: string;
};

const successTone = {
  dotClassName: "bg-success-500",
  textClassName: "text-success-700"
} as const;

const plannedTone = {
  dotClassName: "bg-warm-accent",
  textClassName: "text-warning-700"
} as const;

const warningTone = {
  dotClassName: "bg-warning-500",
  textClassName: "text-warning-700"
} as const;

const neutralTone = {
  dotClassName: "bg-muted-foreground/55",
  textClassName: "text-muted-foreground"
} as const;

export const resourceStatusPresentation = {
  available: {
    ...successTone,
    label: "资源已上线"
  },
  planned: {
    ...plannedTone,
    label: "准备中"
  },
  unavailable: {
    ...neutralTone,
    label: "暂不可用"
  }
} satisfies Record<
  ResolvedCompetitionResource["availability"]["status"],
  StatusPresentation
>;

export const teamStatusPresentation = {
  closed: {
    ...neutralTone,
    label: "入口已关闭"
  },
  expired: {
    ...warningTone,
    label: "入口已过期"
  },
  open: {
    ...successTone,
    label: "入口已开放"
  },
  planned: {
    ...plannedTone,
    label: "入口待开放"
  },
  unavailable: {
    ...neutralTone,
    label: "暂不可用"
  }
} satisfies Record<ResolvedCompetitionTeamAvailability["status"], StatusPresentation>;

export const teamStatusDescriptions = {
  closed: "该竞赛的组队入口当前已关闭。",
  expired: "该竞赛的组队入口已过有效期，暂不提供加入操作。",
  planned: "该竞赛的组队入口正在准备中，完成核验后会在这里开放。",
  unavailable: "暂时无法关联该竞赛的组队信息，请先查看公开来源。"
} satisfies Record<
  Exclude<ResolvedCompetitionTeamAvailability["status"], "open">,
  string
>;
