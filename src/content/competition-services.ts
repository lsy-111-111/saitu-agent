export type CompetitionResourceAvailability =
  | { status: "planned" }
  | {
      status: "available";
      href: string;
      fileName: string;
    };

export type CompetitionResourceKind = "pitch-deck" | "business-plan";

export type CompetitionResourceTemplate = {
  kind: CompetitionResourceKind;
  label: "路演 PPT" | "商业计划书";
  availability: CompetitionResourceAvailability;
};

export type CompetitionTeamAvailability =
  | { status: "planned" }
  | { status: "closed" }
  | { status: "expired" }
  | {
      status: "open";
      qrSrc: string;
      operator: string;
      verifiedAt: string;
      expiresAt: string;
    };

export const competitionResourceTemplates = [
  {
    kind: "pitch-deck",
    label: "路演 PPT",
    availability: { status: "planned" }
  },
  {
    kind: "business-plan",
    label: "商业计划书",
    availability: { status: "planned" }
  }
] satisfies readonly CompetitionResourceTemplate[];

export const defaultCompetitionTeamAvailability = {
  status: "planned"
} satisfies CompetitionTeamAvailability;
