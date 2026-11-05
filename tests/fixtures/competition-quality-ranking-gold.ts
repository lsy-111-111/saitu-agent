import type { CompetitionRankingHoldoutCase } from "./competition-quality-personas";

export const staticCompetitionRankingHoldoutCases = [
  {
    "id": "rank-vocational-algorithm",
    "stageGroup": "vocational",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：高职、全日制在读",
      "专业/任务焦点：算法编程与软件作品",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以算法任务、已有项目和获奖目标定义理想集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "vocational",
      "majorFields": [
        "computer-science"
      ],
      "skills": [
        "programming",
        "data-analysis"
      ],
      "interests": [
        "data",
        "ai"
      ],
      "goals": [
        "award",
        "employment"
      ],
      "preferredOutputs": [
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "solo",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "algorithm",
        "software"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "award"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "solo",
      "specificSubjects": [
        "information-communication",
        "statistics-mathematics"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_vocational_algorithm",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "algorithm-competition",
              "label": "algorithm-competition"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "algorithm-competition"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "baidu-star",
        "relevance": 2,
        "rationale": "算法编程与竞技任务高度契合。",
        "evidenceRef": "official:baidu-star:2026-08-23"
      },
      {
        "competitionId": "matiji-programming",
        "relevance": 2,
        "rationale": "程序设计和算法任务可由当前画像直接支持。",
        "evidenceRef": "official:matiji-programming:2026-08-23"
      },
      {
        "competitionId": "lanqiao-cup",
        "relevance": 2,
        "rationale": "软件与程序设计竞赛可形成就业和获奖证据。",
        "evidenceRef": "official:lanqiao-cup:2026-08-23"
      },
      {
        "competitionId": "global-campus-ai-algorithm",
        "relevance": 1,
        "rationale": "同样需要算法能力，但更偏 AI 应用。",
        "evidenceRef": "official:global-campus-ai-algorithm:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-vocational-business-simulation",
    "stageGroup": "vocational",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：高职、全日制在读",
      "专业/任务焦点：企业经营模拟与数据决策",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以沙盘经营而非宽泛创业意向界定标签。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "vocational",
      "majorFields": [
        "finance-taxation",
        "business"
      ],
      "skills": [
        "accounting-finance",
        "data-analysis",
        "presentation"
      ],
      "interests": [
        "finance-taxation",
        "entrepreneurship"
      ],
      "goals": [
        "employment",
        "award"
      ],
      "preferredOutputs": [
        "business-plan",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "entrepreneurship",
        "product"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "prototype"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "finance-accounting"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_vocational_business-simulation",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "finance-operations",
              "label": "finance-operations"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "finance-operations"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "enterprise-competition-simulation",
        "relevance": 2,
        "rationale": "企业竞争模拟、数据决策和团队陈述与画像一致。",
        "evidenceRef": "official:enterprise-competition-simulation:2026-08-23"
      },
      {
        "competitionId": "xuechuangbei-business-simulation",
        "relevance": 2,
        "rationale": "创业综合模拟和经营决策是同等理想选项。",
        "evidenceRef": "official:xuechuangbei-business-simulation:2026-08-23"
      },
      {
        "competitionId": "business-elite-innovation",
        "relevance": 1,
        "rationale": "商业实践和展示相关，但经营模拟特征较弱。",
        "evidenceRef": "official:business-elite-innovation:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "数据分析与商业汇报相关，但不是经营沙盘。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-vocational-robotics",
    "stageGroup": "vocational",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：高职、全日制在读",
      "专业/任务焦点：机器人硬件系统与原型",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以硬件原型和现成队伍定义机器人候选集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "vocational",
      "majorFields": [
        "engineering",
        "computer-science"
      ],
      "skills": [
        "hardware",
        "programming",
        "product"
      ],
      "interests": [
        "robotics",
        "engineering"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "prototype",
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "equipment",
        "budget"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "hardware",
        "product"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "prototype"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "robotics-automation",
        "engineering-practice"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_vocational_robotics",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "robotics-integration",
              "label": "robotics-integration"
            },
            {
              "value": "hardware-build",
              "label": "hardware-build"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "robotics-integration",
            "hardware-build"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "robotac",
        "relevance": 2,
        "rationale": "机器人对抗与硬件原型适合现有队伍。",
        "evidenceRef": "official:robotac:2026-08-23"
      },
      {
        "competitionId": "raicom-robot-developer",
        "relevance": 2,
        "rationale": "机器人开发与系统集成是画像中的明确偏好。",
        "evidenceRef": "official:raicom-robot-developer:2026-08-23"
      },
      {
        "competitionId": "intelligent-robot-creativity",
        "relevance": 2,
        "rationale": "智能机器人创意和原型实现高度契合。",
        "evidenceRef": "official:intelligent-robot-creativity:2026-08-23"
      },
      {
        "competitionId": "robocup-china",
        "relevance": 1,
        "rationale": "同属机器人系统竞赛，任务设置更专门。",
        "evidenceRef": "official:robocup-china:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-vocational-visual-design",
    "stageGroup": "vocational",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：高职、全日制在读",
      "专业/任务焦点：视觉创意设计与作品集",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "对固定题无法再区分的视觉设计赛事标注多个同等理想项。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "vocational",
      "majorFields": [
        "design"
      ],
      "skills": [
        "design",
        "writing",
        "presentation"
      ],
      "interests": [
        "design",
        "media"
      ],
      "goals": [
        "portfolio",
        "award"
      ],
      "preferredOutputs": [
        "creative-work"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "design"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "portfolio",
        "award"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "visual-communication"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_vocational_visual-design",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "design-portfolio",
              "label": "design-portfolio"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "design-portfolio"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "future-designer-ncda",
        "relevance": 2,
        "rationale": "数字艺术设计和作品集目标高度一致。",
        "evidenceRef": "official:future-designer-ncda:2026-08-23"
      },
      {
        "competitionId": "china-good-design",
        "relevance": 2,
        "rationale": "数字艺术创意成果是画像可见的核心任务。",
        "evidenceRef": "official:china-good-design:2026-08-23"
      },
      {
        "competitionId": "milan-design-week-china",
        "relevance": 2,
        "rationale": "视觉设计成果展示和作品集诉求高度契合。",
        "evidenceRef": "official:milan-design-week-china:2026-08-23"
      },
      {
        "competitionId": "huacan-design-award",
        "relevance": 2,
        "rationale": "创意设计与作品集导向与画像一致。",
        "evidenceRef": "official:huacan-design-award:2026-08-23"
      },
      {
        "competitionId": "digital-media-creative-tech",
        "relevance": 1,
        "rationale": "数字媒体创意与创意作品可作为相关备选。",
        "evidenceRef": "official:digital-media-creative-tech:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-vocational-career-language",
    "stageGroup": "vocational",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：高职、全日制在读",
      "专业/任务焦点：职业规划陈述与口头表达",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "职业目标、求职证据和表达应优先职业规划赛事。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "vocational",
      "majorFields": [
        "humanities",
        "business"
      ],
      "skills": [
        "writing",
        "presentation"
      ],
      "interests": [
        "career",
        "language-communication"
      ],
      "goals": [
        "employment",
        "networking"
      ],
      "preferredOutputs": [
        "career-plan",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "solo",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "career",
        "language"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "portfolio"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "solo",
      "specificSubjects": [
        "language-culture"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_vocational_career-language",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "career-evidence",
              "label": "career-evidence"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "career-evidence"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "career-planning",
        "relevance": 2,
        "rationale": "职业生涯发展陈述和求职证据与画像直接匹配。",
        "evidenceRef": "official:career-planning:2026-08-23"
      },
      {
        "competitionId": "intercultural-competence",
        "relevance": 1,
        "rationale": "沟通展示相关，但任务不是求职陈述。",
        "evidenceRef": "official:intercultural-competence:2026-08-23"
      },
      {
        "competitionId": "chinese-classics",
        "relevance": 1,
        "rationale": "语言文化、写作和展示能力可直接迁移，但赛事不交付职业目标与行动计划。",
        "evidenceRef": "official:chinese-classics:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-lower-algorithm",
    "stageGroup": "undergraduate-lower",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科低年级、全日制在读",
      "专业/任务焦点：算法编程与软件作品",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以算法任务、已有项目和获奖目标定义理想集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-2",
      "majorFields": [
        "computer-science"
      ],
      "skills": [
        "programming",
        "data-analysis"
      ],
      "interests": [
        "data",
        "ai"
      ],
      "goals": [
        "award",
        "employment"
      ],
      "preferredOutputs": [
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "algorithm",
        "software"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "award"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "information-communication",
        "statistics-mathematics"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-lower_algorithm",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "algorithm-competition",
              "label": "algorithm-competition"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "algorithm-competition"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "icpc-programming",
        "relevance": 2,
        "rationale": "算法编程、竞赛获奖和高投入与画像直接对应。",
        "evidenceRef": "official:icpc-programming:2026-08-23"
      },
      {
        "competitionId": "global-campus-ai-algorithm",
        "relevance": 1,
        "rationale": "同样需要算法能力，但更偏 AI 应用。",
        "evidenceRef": "official:global-campus-ai-algorithm:2026-08-23"
      },
      {
        "competitionId": "computer-system-ability",
        "relevance": 1,
        "rationale": "编程与软件交付证据可用于系统实践，但画像未确认操作系统、编译或芯片系统专项经验。",
        "evidenceRef": "official:computer-system-ability:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-lower-business-simulation",
    "stageGroup": "undergraduate-lower",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科低年级、全日制在读",
      "专业/任务焦点：企业经营模拟与数据决策",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以沙盘经营而非宽泛创业意向界定标签。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-2",
      "majorFields": [
        "finance-taxation",
        "business"
      ],
      "skills": [
        "accounting-finance",
        "data-analysis",
        "presentation"
      ],
      "interests": [
        "finance-taxation",
        "entrepreneurship"
      ],
      "goals": [
        "employment",
        "award"
      ],
      "preferredOutputs": [
        "business-plan",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "entrepreneurship",
        "product"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "prototype"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "finance-accounting"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-lower_business-simulation",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "finance-operations",
              "label": "finance-operations"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "finance-operations"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "enterprise-competition-simulation",
        "relevance": 2,
        "rationale": "企业竞争模拟、数据决策和团队陈述与画像一致。",
        "evidenceRef": "official:enterprise-competition-simulation:2026-08-23"
      },
      {
        "competitionId": "xuechuangbei-business-simulation",
        "relevance": 2,
        "rationale": "创业综合模拟和经营决策是同等理想选项。",
        "evidenceRef": "official:xuechuangbei-business-simulation:2026-08-23"
      },
      {
        "competitionId": "business-elite-innovation",
        "relevance": 1,
        "rationale": "商业实践和展示相关，但经营模拟特征较弱。",
        "evidenceRef": "official:business-elite-innovation:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "数据分析与商业汇报相关，但不是经营沙盘。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-lower-robotics",
    "stageGroup": "undergraduate-lower",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科低年级、全日制在读",
      "专业/任务焦点：机器人硬件系统与原型",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以硬件原型和现成队伍定义机器人候选集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-2",
      "majorFields": [
        "engineering",
        "computer-science"
      ],
      "skills": [
        "hardware",
        "programming",
        "product"
      ],
      "interests": [
        "robotics",
        "engineering"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "prototype",
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "equipment",
        "budget"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "hardware",
        "product"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "prototype"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "robotics-automation",
        "engineering-practice"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-lower_robotics",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "robotics-integration",
              "label": "robotics-integration"
            },
            {
              "value": "hardware-build",
              "label": "hardware-build"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "robotics-integration",
            "hardware-build"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "robocon",
        "relevance": 2,
        "rationale": "硬件、编程、机器人集成和完整原型均与画像一致。",
        "evidenceRef": "official:robocon:2026-08-23"
      },
      {
        "competitionId": "robotac",
        "relevance": 2,
        "rationale": "机器人对抗与硬件原型适合现有队伍。",
        "evidenceRef": "official:robotac:2026-08-23"
      },
      {
        "competitionId": "raicom-robot-developer",
        "relevance": 2,
        "rationale": "机器人开发与系统集成是画像中的明确偏好。",
        "evidenceRef": "official:raicom-robot-developer:2026-08-23"
      },
      {
        "competitionId": "intelligent-robot-creativity",
        "relevance": 2,
        "rationale": "智能机器人创意和原型实现高度契合。",
        "evidenceRef": "official:intelligent-robot-creativity:2026-08-23"
      },
      {
        "competitionId": "china-robot-ai",
        "relevance": 2,
        "rationale": "机器人与 AI 实践目标同时匹配。",
        "evidenceRef": "official:china-robot-ai:2026-08-23"
      },
      {
        "competitionId": "smart-car",
        "relevance": 1,
        "rationale": "智能车是窄化的机器人硬件系统备选。",
        "evidenceRef": "official:smart-car:2026-08-23"
      },
      {
        "competitionId": "robocup-china",
        "relevance": 1,
        "rationale": "同属机器人系统竞赛，任务设置更专门。",
        "evidenceRef": "official:robocup-china:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-lower-visual-design",
    "stageGroup": "undergraduate-lower",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科低年级、全日制在读",
      "专业/任务焦点：视觉创意设计与作品集",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "对固定题无法再区分的视觉设计赛事标注多个同等理想项。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-2",
      "majorFields": [
        "design"
      ],
      "skills": [
        "design",
        "writing",
        "presentation"
      ],
      "interests": [
        "design",
        "media"
      ],
      "goals": [
        "portfolio",
        "award"
      ],
      "preferredOutputs": [
        "creative-work"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "design"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "portfolio",
        "award"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "visual-communication"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-lower_visual-design",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "design-portfolio",
              "label": "design-portfolio"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "design-portfolio"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "national-advertising-art",
        "relevance": 2,
        "rationale": "广告创意、视觉设计与作品集直接对应。",
        "evidenceRef": "official:national-advertising-art:2026-08-23"
      },
      {
        "competitionId": "future-designer-ncda",
        "relevance": 2,
        "rationale": "数字艺术设计和作品集目标高度一致。",
        "evidenceRef": "official:future-designer-ncda:2026-08-23"
      },
      {
        "competitionId": "china-good-design",
        "relevance": 2,
        "rationale": "数字艺术创意成果是画像可见的核心任务。",
        "evidenceRef": "official:china-good-design:2026-08-23"
      },
      {
        "competitionId": "milan-design-week-china",
        "relevance": 2,
        "rationale": "视觉设计成果展示和作品集诉求高度契合。",
        "evidenceRef": "official:milan-design-week-china:2026-08-23"
      },
      {
        "competitionId": "huacan-design-award",
        "relevance": 2,
        "rationale": "创意设计与作品集导向与画像一致。",
        "evidenceRef": "official:huacan-design-award:2026-08-23"
      },
      {
        "competitionId": "digital-media-creative-tech",
        "relevance": 1,
        "rationale": "数字媒体创意与创意作品可作为相关备选。",
        "evidenceRef": "official:digital-media-creative-tech:2026-08-23"
      },
      {
        "competitionId": "national-college-industrial-design",
        "relevance": 1,
        "rationale": "同属设计作品集，但产品方向更窄。",
        "evidenceRef": "official:national-college-industrial-design:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-lower-career-language",
    "stageGroup": "undergraduate-lower",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科低年级、全日制在读",
      "专业/任务焦点：职业规划陈述与口头表达",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "职业目标、求职证据和表达应优先职业规划赛事。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-2",
      "majorFields": [
        "humanities",
        "business"
      ],
      "skills": [
        "writing",
        "presentation"
      ],
      "interests": [
        "career",
        "language-communication"
      ],
      "goals": [
        "employment",
        "networking"
      ],
      "preferredOutputs": [
        "career-plan",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "solo",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "career",
        "language"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "portfolio"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "solo",
      "specificSubjects": [
        "language-culture"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-lower_career-language",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "career-evidence",
              "label": "career-evidence"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "career-evidence"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "career-planning",
        "relevance": 2,
        "rationale": "职业生涯发展陈述和求职证据与画像直接匹配。",
        "evidenceRef": "official:career-planning:2026-08-23"
      },
      {
        "competitionId": "21st-century-english-speaking",
        "relevance": 1,
        "rationale": "演讲表达相关，但不聚焦职业规划。",
        "evidenceRef": "official:21st-century-english-speaking:2026-08-23"
      },
      {
        "competitionId": "intercultural-competence",
        "relevance": 1,
        "rationale": "沟通展示相关，但任务不是求职陈述。",
        "evidenceRef": "official:intercultural-competence:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-upper-chemistry-lab",
    "stageGroup": "undergraduate-upper",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科高年级、全日制在读",
      "专业/任务焦点：化学/化工实验研究与方案设计",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以实验、研究证据和实验室资源区分化学与宽泛工程赛事。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-4",
      "majorFields": [
        "chemistry-materials",
        "engineering"
      ],
      "skills": [
        "laboratory",
        "research",
        "data-analysis"
      ],
      "interests": [
        "chemistry-materials",
        "academic-research"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "research-paper",
        "prototype"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "lab",
        "equipment"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "research",
        "hardware"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "paper"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "chemistry-chemical",
        "mechanics-materials"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-upper_chemistry-lab",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "chemical-engineering-experiment",
        "relevance": 2,
        "rationale": "化工实验任务与实验室资源直接匹配。",
        "evidenceRef": "official:chemical-engineering-experiment:2026-08-23"
      },
      {
        "competitionId": "chemistry-experiment-innovation",
        "relevance": 2,
        "rationale": "化学实验创新设计与研究成果直接匹配。",
        "evidenceRef": "official:chemistry-experiment-innovation:2026-08-23"
      },
      {
        "competitionId": "chemical-engineering-design",
        "relevance": 1,
        "rationale": "化工方案设计相关，但不以实验操作为核心。",
        "evidenceRef": "official:chemical-engineering-design:2026-08-23"
      },
      {
        "competitionId": "physics-experiment-innovation",
        "relevance": 1,
        "rationale": "实验设计、仪器操作和研究报告证据可迁移，但画像主学科为化学且未确认物理实验专题。",
        "evidenceRef": "official:physics-experiment-innovation:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-upper-digital-building",
    "stageGroup": "undergraduate-upper",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科高年级、全日制在读",
      "专业/任务焦点：结构/BIM/数字建造设计",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "以工程设计和数字原型定义建筑土木去向。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-4",
      "majorFields": [
        "civil-architecture",
        "engineering"
      ],
      "skills": [
        "structural-design",
        "design",
        "hardware"
      ],
      "interests": [
        "civil-architecture",
        "engineering"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "prototype",
        "creative-work"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "equipment"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "design",
        "hardware",
        "product"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "prototype"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "civil-architecture",
        "digital-construction"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-upper_digital-building",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "design-portfolio",
              "label": "design-portfolio"
            },
            {
              "value": "hardware-build",
              "label": "hardware-build"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "design-portfolio",
            "hardware-build"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "national-structural-design",
        "relevance": 2,
        "rationale": "结构设计与工程原型高度匹配。",
        "evidenceRef": "official:national-structural-design:2026-08-23"
      },
      {
        "competitionId": "bim-graduation-design",
        "relevance": 2,
        "rationale": "BIM 毕业设计与数字建模成果直接匹配。",
        "evidenceRef": "official:bim-graduation-design:2026-08-23"
      },
      {
        "competitionId": "digital-building-innovation",
        "relevance": 2,
        "rationale": "数字建筑应用和原型与画像一致。",
        "evidenceRef": "official:digital-building-innovation:2026-08-23"
      },
      {
        "competitionId": "advanced-graphics-bim",
        "relevance": 2,
        "rationale": "先进成图与 BIM 建模为同等合理去向。",
        "evidenceRef": "official:advanced-graphics-bim:2026-08-23"
      },
      {
        "competitionId": "garden-design-build",
        "relevance": 1,
        "rationale": "设计建造任务相关，但景观方向更窄。",
        "evidenceRef": "official:garden-design-build:2026-08-23"
      },
      {
        "competitionId": "surveying-innovation",
        "relevance": 1,
        "rationale": "测绘与数字建造相关，但核心任务不同。",
        "evidenceRef": "official:surveying-innovation:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-upper-medical-research",
    "stageGroup": "undergraduate-upper",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科高年级、全日制在读",
      "专业/任务焦点：医学/生命科学实验研究",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数、PI/导师、实验室、安全合规和经费条件已确认"
    ],
    "rationale": "医学研究画像允许技能、基础医学和生命科学的多个合理去向。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-4",
      "majorFields": [
        "medicine",
        "biology-life-science"
      ],
      "skills": [
        "laboratory",
        "research",
        "data-analysis"
      ],
      "interests": [
        "medicine-health",
        "biology-life-science",
        "academic-research"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "research-paper",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "lab",
        "data",
        "equipment",
        "budget",
        "safety-compliance"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "paper",
        "project"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "medicine-health",
        "biology-life-science",
        "synthetic-biology"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-upper_medical-research",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "basic-medicine-innovation",
        "relevance": 2,
        "rationale": "基础医学实验研究和论文证据直接匹配。",
        "evidenceRef": "official:basic-medicine-innovation:2026-08-23"
      },
      {
        "competitionId": "culsc-life-sciences",
        "relevance": 2,
        "rationale": "生命科学实验研究是同等理想去向。",
        "evidenceRef": "official:culsc-life-sciences:2026-08-23"
      },
      {
        "competitionId": "igem-collegiate",
        "relevance": 2,
        "rationale": "画像明确 synthetic-biology、实验研究、论文与项目证据，并具备导师、实验室、设备、经费和安全合规资源；PI名册仍待核验只影响资格状态，不降低任务匹配层级。",
        "evidenceRef": "official:igem-collegiate:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-upper-electronics",
    "stageGroup": "undergraduate-upper",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科高年级、全日制在读",
      "专业/任务焦点：电子/嵌入式硬件原型",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "硬件、编程和原型证据界定电子设计去向。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-4",
      "majorFields": [
        "engineering",
        "computer-science"
      ],
      "skills": [
        "hardware",
        "programming",
        "product"
      ],
      "interests": [
        "engineering",
        "innovation"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "prototype",
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "equipment",
        "budget"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "hardware",
        "software"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "prototype"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "information-communication",
        "engineering-practice"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-upper_electronics",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "hardware-build",
              "label": "hardware-build"
            },
            {
              "value": "software-engineering",
              "label": "software-engineering"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "hardware-build",
            "software-engineering"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "embedded-chip-system-design",
        "relevance": 2,
        "rationale": "嵌入式芯片与系统原型为同等可接受去向。",
        "evidenceRef": "official:embedded-chip-system-design:2026-08-23"
      },
      {
        "competitionId": "integrated-circuit-innovation",
        "relevance": 2,
        "rationale": "集成电路创新和硬件原型高度契合。",
        "evidenceRef": "official:integrated-circuit-innovation:2026-08-23"
      },
      {
        "competitionId": "national-college-electronic-design",
        "relevance": 2,
        "rationale": "赛事面向本科生的电子系统设计与制作，与画像已确认的电子信息、硬件联调和完整原型直接一致。",
        "evidenceRef": "official:national-college-electronic-design:2026-08-23"
      },
      {
        "competitionId": "optoelectronic-design",
        "relevance": 1,
        "rationale": "光电硬件是可解释的窄化备选。",
        "evidenceRef": "official:optoelectronic-design:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-undergraduate-upper-finance-tax",
    "stageGroup": "undergraduate-upper",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：本科高年级、全日制在读",
      "专业/任务焦点：财税案例、会计数据与商业汇报",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "将财税案例与一般经营模拟分层标注。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "undergraduate-4",
      "majorFields": [
        "finance-taxation",
        "business"
      ],
      "skills": [
        "accounting-finance",
        "data-analysis",
        "research"
      ],
      "interests": [
        "finance-taxation",
        "data",
        "career"
      ],
      "goals": [
        "employment",
        "award"
      ],
      "preferredOutputs": [
        "research-paper",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "5-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "research",
        "entrepreneurship"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "paper"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "finance-accounting"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_undergraduate-upper_finance-tax",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "finance-operations",
              "label": "finance-operations"
            },
            {
              "value": "field-research",
              "label": "field-research"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "finance-operations",
            "field-research"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "tax-risk-case",
        "relevance": 2,
        "rationale": "税收风险案例分析与研究汇报直接匹配。",
        "evidenceRef": "official:tax-risk-case:2026-08-23"
      },
      {
        "competitionId": "icbc-fintech-innovation",
        "relevance": 1,
        "rationale": "金融数据与商业展示相关，但更偏技术创新。",
        "evidenceRef": "official:icbc-fintech-innovation:2026-08-23"
      },
      {
        "competitionId": "enterprise-competition-simulation",
        "relevance": 1,
        "rationale": "企业竞争模拟、数据决策和团队陈述与画像一致。但本画像更聚焦财税案例。",
        "evidenceRef": "official:enterprise-competition-simulation:2026-08-23"
      },
      {
        "competitionId": "xuechuangbei-business-simulation",
        "relevance": 1,
        "rationale": "创业综合模拟和经营决策是同等理想选项。但本画像更聚焦财税案例。",
        "evidenceRef": "official:xuechuangbei-business-simulation:2026-08-23"
      },
      {
        "competitionId": "business-elite-innovation",
        "relevance": 1,
        "rationale": "商业实践和展示相关，但经营模拟特征较弱。但本画像更聚焦财税案例。",
        "evidenceRef": "official:business-elite-innovation:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "数据分析与商业汇报相关，但不是经营沙盘。但本画像更聚焦财税案例。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-master-modeling",
    "stageGroup": "master",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：硕士、全日制在读",
      "专业/任务焦点：数学建模与学术报告",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "研究生学段和建模任务共同决定理想集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "master",
      "majorFields": [
        "mathematics",
        "computer-science"
      ],
      "skills": [
        "data-analysis",
        "research",
        "programming"
      ],
      "interests": [
        "data",
        "academic-research"
      ],
      "goals": [
        "award",
        "postgraduate"
      ],
      "preferredOutputs": [
        "research-paper"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "modeling",
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "paper",
        "project"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "statistics-mathematics"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_master_modeling",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "modeling-intensive",
              "label": "modeling-intensive"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "modeling-intensive",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "statistical-modeling",
        "relevance": 2,
        "rationale": "统计建模与数据研究为同等合理去向。",
        "evidenceRef": "official:statistical-modeling:2026-08-23"
      },
      {
        "competitionId": "graduate-math-modeling",
        "relevance": 2,
        "rationale": "研究生学段、建模任务与学术报告成果均直接匹配。",
        "evidenceRef": "official:graduate-math-modeling:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "数据采集、统计分析和研究报告与建模证据相邻，但还需商业问卷与抽样设计。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      },
      {
        "competitionId": "energy-economics-academic-creativity",
        "relevance": 1,
        "rationale": "数据建模、计量分析和学术写作可迁移，但画像未确认能源市场或经济机制专题。",
        "evidenceRef": "official:energy-economics-academic-creativity:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-master-electronics",
    "stageGroup": "master",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：硕士、全日制在读",
      "专业/任务焦点：电子/嵌入式硬件研发",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "研究生学段和完整硬件原型共同界定电子设计去向。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "master",
      "majorFields": [
        "engineering",
        "computer-science"
      ],
      "skills": [
        "hardware",
        "programming",
        "product"
      ],
      "interests": [
        "engineering",
        "innovation"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "prototype",
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "equipment",
        "budget"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "hardware",
        "software"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "prototype",
        "award"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "information-communication",
        "engineering-practice"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_master_electronics",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "hardware-build",
              "label": "hardware-build"
            },
            {
              "value": "software-engineering",
              "label": "software-engineering"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "hardware-build",
            "software-engineering"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-electronic-design",
        "relevance": 2,
        "rationale": "研究生电子设计、嵌入式开发和原型成果直接匹配。",
        "evidenceRef": "official:graduate-electronic-design:2026-08-23"
      },
      {
        "competitionId": "embedded-chip-system-design",
        "relevance": 2,
        "rationale": "嵌入式芯片与系统原型为同等可接受去向。",
        "evidenceRef": "official:embedded-chip-system-design:2026-08-23"
      },
      {
        "competitionId": "integrated-circuit-innovation",
        "relevance": 2,
        "rationale": "集成电路创新和硬件原型高度契合。",
        "evidenceRef": "official:integrated-circuit-innovation:2026-08-23"
      },
      {
        "competitionId": "huawei-ict",
        "relevance": 1,
        "rationale": "电子信息、编程与系统联调经验可迁移，但云网平台和认证生态并非现有硬件原型的核心交付。",
        "evidenceRef": "official:huawei-ict:2026-08-23"
      },
      {
        "competitionId": "china-robot-ai",
        "relevance": 1,
        "rationale": "硬件、编程和系统联调与电子原型相邻，但画像未确认机器人感知、决策或具身任务证据。",
        "evidenceRef": "official:china-robot-ai:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-master-ai-research",
    "stageGroup": "master",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：硕士、全日制在读",
      "专业/任务焦点：AI 算法、软件原型与研究成果",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "将研究生 AI 创新与通用算法竞技区分。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "master",
      "majorFields": [
        "computer-science",
        "mathematics"
      ],
      "skills": [
        "programming",
        "data-analysis",
        "research"
      ],
      "interests": [
        "ai",
        "data",
        "academic-research"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "software",
        "research-paper"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "algorithm",
        "software",
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "paper"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "information-communication",
        "statistics-mathematics"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_master_ai-research",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "algorithm-competition",
              "label": "algorithm-competition"
            },
            {
              "value": "software-engineering",
              "label": "software-engineering"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "algorithm-competition",
            "software-engineering",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-ai-innovation",
        "relevance": 2,
        "rationale": "研究生 AI 算法、软件原型和科研成果直接匹配。",
        "evidenceRef": "official:graduate-ai-innovation:2026-08-23"
      },
      {
        "competitionId": "global-campus-ai-algorithm",
        "relevance": 2,
        "rationale": "AI 算法与项目证据为同等理想去向。",
        "evidenceRef": "official:global-campus-ai-algorithm:2026-08-23"
      },
      {
        "competitionId": "china-robot-ai",
        "relevance": 1,
        "rationale": "AI 相关，但对硬件和机器人的侧重更高。",
        "evidenceRef": "official:china-robot-ai:2026-08-23"
      },
      {
        "competitionId": "icpc-programming",
        "relevance": 1,
        "rationale": "高强度算法实现和编程能力可直接复用，但赛事不交付 AI 模型、实验证据或研究型软件原型。",
        "evidenceRef": "official:icpc-programming:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-master-public-management",
    "stageGroup": "master",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：硕士、全日制在读",
      "专业/任务焦点：公共管理案例研究与政策报告",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "公共管理专题是人工审核事实，不由任一目标赛事生成。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "master",
      "majorFields": [
        "public-management",
        "humanities"
      ],
      "skills": [
        "policy-analysis",
        "fieldwork",
        "research"
      ],
      "interests": [
        "public-management",
        "academic-research"
      ],
      "goals": [
        "postgraduate",
        "project"
      ],
      "preferredOutputs": [
        "research-paper",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "paper",
        "project"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "public-management"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_master_public-management",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "field-research",
              "label": "field-research"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "field-research",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-public-management-case",
        "relevance": 2,
        "rationale": "研究生公共管理案例分析和研究报告直接匹配。",
        "evidenceRef": "official:graduate-public-management-case:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "调研分析与报告成果相关，但不是公共管理专属案例。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      },
      {
        "competitionId": "challenge-cup-academic-science",
        "relevance": 1,
        "rationale": "社科调研可承载类似成果，但专业定位更宽。",
        "evidenceRef": "official:challenge-cup-academic-science:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-master-culture",
    "stageGroup": "master",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：硕士、全日制在读",
      "专业/任务焦点：中华文化创新传播与创意成果",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "文化主题、语言表达和创意成果共同界定可接受集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "master",
      "majorFields": [
        "language-culture",
        "humanities"
      ],
      "skills": [
        "language",
        "writing",
        "research"
      ],
      "interests": [
        "culture-language",
        "language-communication",
        "academic-research"
      ],
      "goals": [
        "portfolio",
        "postgraduate"
      ],
      "preferredOutputs": [
        "creative-work",
        "research-paper"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "language",
        "research",
        "design"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "portfolio",
        "paper"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "language-culture"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_master_culture",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "language-communication",
              "label": "language-communication"
            },
            {
              "value": "design-portfolio",
              "label": "design-portfolio"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "language-communication",
            "design-portfolio",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-culture-china",
        "relevance": 2,
        "rationale": "研究生中华文化创新传播和创意成果直接匹配。",
        "evidenceRef": "official:graduate-culture-china:2026-08-23"
      },
      {
        "competitionId": "chinese-classics",
        "relevance": 2,
        "rationale": "中华经典语言表达与文化传播高度一致。",
        "evidenceRef": "official:chinese-classics:2026-08-23"
      },
      {
        "competitionId": "understanding-contemporary-china-foreign-language",
        "relevance": 1,
        "rationale": "文化传播与语言表达相关，但更偏外语能力。",
        "evidenceRef": "official:understanding-contemporary-china-foreign-language:2026-08-23"
      },
      {
        "competitionId": "intercultural-competence",
        "relevance": 1,
        "rationale": "跨文化沟通相关，但不聚焦中华文化两创成果。",
        "evidenceRef": "official:intercultural-competence:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-doctorate-or-recent-modeling",
    "stageGroup": "doctorate-or-recent",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：博士、全日制在读",
      "专业/任务焦点：数学建模与学术报告",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "研究生学段和建模任务共同决定理想集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "doctorate",
      "majorFields": [
        "mathematics",
        "computer-science"
      ],
      "skills": [
        "data-analysis",
        "research",
        "programming"
      ],
      "interests": [
        "data",
        "academic-research"
      ],
      "goals": [
        "award",
        "postgraduate"
      ],
      "preferredOutputs": [
        "research-paper"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "modeling",
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "paper",
        "project"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "statistics-mathematics"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_doctorate-or-recent_modeling",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "modeling-intensive",
              "label": "modeling-intensive"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "modeling-intensive",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "statistical-modeling",
        "relevance": 2,
        "rationale": "统计建模与数据研究为同等合理去向。",
        "evidenceRef": "official:statistical-modeling:2026-08-23"
      },
      {
        "competitionId": "graduate-math-modeling",
        "relevance": 2,
        "rationale": "研究生学段、建模任务与学术报告成果均直接匹配。",
        "evidenceRef": "official:graduate-math-modeling:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "高阶建模、统计分析和研究报告证据可迁移，但市场调查还需商业问卷与抽样设计。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      },
      {
        "competitionId": "energy-economics-academic-creativity",
        "relevance": 1,
        "rationale": "高阶数据建模和学术论文证据可迁移，但画像未确认能源市场或经济机制专题。",
        "evidenceRef": "official:energy-economics-academic-creativity:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-doctorate-or-recent-electronics",
    "stageGroup": "doctorate-or-recent",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：博士、全日制在读",
      "专业/任务焦点：电子/嵌入式硬件研发",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "研究生学段和完整硬件原型共同界定电子设计去向。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "doctorate",
      "majorFields": [
        "engineering",
        "computer-science"
      ],
      "skills": [
        "hardware",
        "programming",
        "product"
      ],
      "interests": [
        "engineering",
        "innovation"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "prototype",
        "software"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "equipment",
        "budget"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "hardware",
        "software"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "prototype",
        "award"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "information-communication",
        "engineering-practice"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_doctorate-or-recent_electronics",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "hardware-build",
              "label": "hardware-build"
            },
            {
              "value": "software-engineering",
              "label": "software-engineering"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "hardware-build",
            "software-engineering"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-electronic-design",
        "relevance": 2,
        "rationale": "研究生电子设计、嵌入式开发和原型成果直接匹配。",
        "evidenceRef": "official:graduate-electronic-design:2026-08-23"
      },
      {
        "competitionId": "embedded-chip-system-design",
        "relevance": 2,
        "rationale": "嵌入式芯片与系统原型为同等可接受去向。",
        "evidenceRef": "official:embedded-chip-system-design:2026-08-23"
      },
      {
        "competitionId": "integrated-circuit-innovation",
        "relevance": 2,
        "rationale": "集成电路创新和硬件原型高度契合。",
        "evidenceRef": "official:integrated-circuit-innovation:2026-08-23"
      },
      {
        "competitionId": "huawei-ict",
        "relevance": 1,
        "rationale": "电子信息、编程和系统联调能力可迁移，但云网平台与现有硬件研究原型不是同一交付。",
        "evidenceRef": "official:huawei-ict:2026-08-23"
      },
      {
        "competitionId": "china-robot-ai",
        "relevance": 1,
        "rationale": "硬件、软件和系统联调能力与电子研发相邻，但画像未确认机器人感知、决策或具身场景证据。",
        "evidenceRef": "official:china-robot-ai:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-doctorate-or-recent-ai-research",
    "stageGroup": "doctorate-or-recent",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：博士、全日制在读",
      "专业/任务焦点：AI 算法、软件原型与研究成果",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "将研究生 AI 创新与通用算法竞技区分。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "doctorate",
      "majorFields": [
        "computer-science",
        "mathematics"
      ],
      "skills": [
        "programming",
        "data-analysis",
        "research"
      ],
      "interests": [
        "ai",
        "data",
        "academic-research"
      ],
      "goals": [
        "project",
        "award"
      ],
      "preferredOutputs": [
        "software",
        "research-paper"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "algorithm",
        "software",
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "project",
        "paper"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "information-communication",
        "statistics-mathematics"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_doctorate-or-recent_ai-research",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "algorithm-competition",
              "label": "algorithm-competition"
            },
            {
              "value": "software-engineering",
              "label": "software-engineering"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "algorithm-competition",
            "software-engineering",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-ai-innovation",
        "relevance": 2,
        "rationale": "研究生 AI 算法、软件原型和科研成果直接匹配。",
        "evidenceRef": "official:graduate-ai-innovation:2026-08-23"
      },
      {
        "competitionId": "global-campus-ai-algorithm",
        "relevance": 2,
        "rationale": "AI 算法与项目证据为同等理想去向。",
        "evidenceRef": "official:global-campus-ai-algorithm:2026-08-23"
      },
      {
        "competitionId": "china-robot-ai",
        "relevance": 1,
        "rationale": "AI 相关，但对硬件和机器人的侧重更高。",
        "evidenceRef": "official:china-robot-ai:2026-08-23"
      },
      {
        "competitionId": "icpc-programming",
        "relevance": 1,
        "rationale": "高强度算法实现和编程能力可直接复用，但赛事不交付 AI 模型、实验证据或研究型应用原型。",
        "evidenceRef": "official:icpc-programming:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-doctorate-or-recent-public-management",
    "stageGroup": "doctorate-or-recent",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：博士、全日制在读",
      "专业/任务焦点：公共管理案例研究与政策报告",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "公共管理专题是人工审核事实，不由任一目标赛事生成。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "doctorate",
      "majorFields": [
        "public-management",
        "humanities"
      ],
      "skills": [
        "policy-analysis",
        "fieldwork",
        "research"
      ],
      "interests": [
        "public-management",
        "academic-research"
      ],
      "goals": [
        "postgraduate",
        "project"
      ],
      "preferredOutputs": [
        "research-paper",
        "presentation"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "research"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "paper",
        "project"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "public-management"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_doctorate-or-recent_public-management",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "field-research",
              "label": "field-research"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "field-research",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-public-management-case",
        "relevance": 2,
        "rationale": "研究生公共管理案例分析和研究报告直接匹配。",
        "evidenceRef": "official:graduate-public-management-case:2026-08-23"
      },
      {
        "competitionId": "market-research-analysis",
        "relevance": 1,
        "rationale": "调研分析与报告成果相关，但不是公共管理专属案例。",
        "evidenceRef": "official:market-research-analysis:2026-08-23"
      },
      {
        "competitionId": "challenge-cup-academic-science",
        "relevance": 1,
        "rationale": "社会调查可承载政策分析和研究论文，但赛事主题比公共管理案例更宽；申报身份仍独立待核验。",
        "evidenceRef": "official:challenge-cup-academic-science:2026-08-23"
      }
    ]
  },
  {
    "id": "rank-doctorate-or-recent-culture",
    "stageGroup": "doctorate-or-recent",
    "profileOrigin": "expert-authored-independent",
    "visibleFacts": [
      "学段与学习状态：博士、全日制在读",
      "专业/任务焦点：中华文化创新传播与创意成果",
      "已有项目或原型证据，不是纯意向画像",
      "每周可投入 5 小时以上，参赛时间灵活",
      "队伍人数与参赛单位事实已确认"
    ],
    "rationale": "文化主题、语言表达和创意成果共同界定可接受集。",
    "profile": {
      "profileVersion": "competition-profile.v5",
      "questionnaireVersion": "competition-questionnaire.v1",
      "confirmedFields": [
        "stage",
        "majorFields",
        "specificSubjects",
        "skills",
        "interests",
        "goals",
        "preferredOutputs",
        "startingPoint",
        "weeklyCommitment",
        "teamStatus",
        "availableResources",
        "participationMode",
        "participationTiming",
        "taskFormats",
        "experienceLevel",
        "evidence"
      ],
      "confirmedFacts": [
        "enrollmentStatus",
        "teamUnit",
        "teamSize"
      ],
      "stage": "doctorate",
      "majorFields": [
        "language-culture",
        "humanities"
      ],
      "skills": [
        "language",
        "writing",
        "research"
      ],
      "interests": [
        "culture-language",
        "language-communication",
        "academic-research"
      ],
      "goals": [
        "portfolio",
        "postgraduate"
      ],
      "preferredOutputs": [
        "creative-work",
        "research-paper"
      ],
      "startingPoint": "prototype",
      "weeklyCommitment": "over-10",
      "teamStatus": "ready",
      "availableResources": [
        "mentor",
        "data"
      ],
      "participationMode": "flexible",
      "participationTiming": "flexible",
      "taskFormats": [
        "language",
        "research",
        "design"
      ],
      "experienceLevel": "project-or-award",
      "evidence": [
        "portfolio",
        "paper"
      ],
      "enrollmentStatus": "full-time-student",
      "teamUnit": "same-unit",
      "teamSize": "three",
      "specificSubjects": [
        "language-culture"
      ]
    },
    "transcript": [
      {
        "question": {
          "questionId": "benchmark_holdout_fit_doctorate-or-recent_culture",
          "signalKey": "competition-fit",
          "prompt": "你最希望重点证明哪一类实战能力？",
          "selection": "multiple",
          "options": [
            {
              "value": "language-communication",
              "label": "language-communication"
            },
            {
              "value": "design-portfolio",
              "label": "design-portfolio"
            },
            {
              "value": "research-provenance",
              "label": "research-provenance"
            }
          ],
          "allowsNote": true,
          "maxNoteLength": 120
        },
        "answer": {
          "selectedValues": [
            "language-communication",
            "design-portfolio",
            "research-provenance"
          ]
        }
      }
    ],
    "labels": [
      {
        "competitionId": "graduate-culture-china",
        "relevance": 2,
        "rationale": "研究生中华文化创新传播和创意成果直接匹配。",
        "evidenceRef": "official:graduate-culture-china:2026-08-23"
      },
      {
        "competitionId": "chinese-classics",
        "relevance": 2,
        "rationale": "中华经典语言表达与文化传播高度一致。",
        "evidenceRef": "official:chinese-classics:2026-08-23"
      },
      {
        "competitionId": "understanding-contemporary-china-foreign-language",
        "relevance": 1,
        "rationale": "文化传播与语言表达相关，但更偏外语能力。",
        "evidenceRef": "official:understanding-contemporary-china-foreign-language:2026-08-23"
      },
      {
        "competitionId": "intercultural-competence",
        "relevance": 1,
        "rationale": "跨文化沟通相关，但不聚焦中华文化两创成果。",
        "evidenceRef": "official:intercultural-competence:2026-08-23"
      }
    ]
  }
] satisfies CompetitionRankingHoldoutCase[];
