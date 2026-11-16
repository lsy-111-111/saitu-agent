import type { ResearchedContent } from "./research-types";

/** Source-grounded author drafts; no review or publication status is inferred. */
export const artsBusinessResearchB: ResearchedContent[] = [
  {
    "seriesId": "national-advertising-art",
    "name": "全国大学生广告艺术大赛",
    "organizer": "大广赛组委会",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2026-18-aliyun",
    "edition": "第18届2026阿里云命题",
    "groupId": "fulltime-students",
    "group": "全日制在校大学生、研究生",
    "scopeId": "china-aliyun-graphic",
    "scope": "全国阿里云平面命题；校赛、赛区推荐通道",
    "origin": "legacy_135",
    "trackId": "graphic",
    "trackName": "阿里云平面广告",
    "taskFamily": "visual-interaction",
    "subjectDomains": [
      "arts",
      "management"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-ad-rules",
        "url": "https://www.sun-ada.net/home/about_intrs2.html",
        "title": "第18届参赛指南（4月1日修订）",
        "publisher": "大广赛组委会",
        "scope": "2026全国平面类",
        "locator": "第一部分一、四A、五；第二部分二至四",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-ad-task",
        "url": "https://www.sun-ada.net/home/zt_xqs3026.html",
        "title": "阿里云命题策略单",
        "publisher": "大广赛组委会",
        "scope": "2026阿里云命题",
        "locator": "广告主题、目标群体、创作须知、广告形式1",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-ad-shaoyang-2026-reference",
        "url": "https://www.syzyedu.com/Uploads/202606/6a338bf15e345.pdf",
        "title": "第18届大广赛邵阳职业技术学院校赛通知",
        "publisher": "邵阳职业技术学院",
        "scope": "2026校赛各类作品评分；仅作为本历史命题训练参考，不是全国总评标准",
        "locator": "完整5页；第1页主办/参赛对象，第4页七、校赛评审四项权重，第5页日期",
        "authority": "university_local",
        "checkedAt": "2026-11-06",
        "retrievedAt": "2026-11-06",
        "publishedAt": "2026-05-10",
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch03/reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "全日制在校大学生和研究生可参加；平面作者至多2人、导师至多1人，同校组队。",
        "source": 0
      },
      "track": {
        "text": "选择阿里云千问平面命题，须使用千问及配套工具辅助创作并自拟品牌口号。 该品牌创作须知要求AI创作融合、原创创意、传播性与美誉度；这些是命题创作约束，不声明为正式评分维度。",
        "source": 1
      },
      "participation": {
        "text": "线上正式提交后经学校、赛区逐级推荐，全国不受理个人直接报送。",
        "source": 0
      },
      "deliverables": {
        "text": "A3竖版平面广告；按通则RGB、300dpi、JPG单图不超5MB，系列最多3幅。",
        "source": [
          0,
          1
        ]
      },
      "rubric": {
        "text": "训练参考评分：邵阳职业技术学院第18届2026校赛对各类作品采用作品创意30%、艺术表现30%、制作质量30%、作品规范10%。本条用这份同届校赛公开尺度检查阿里云平面练习，不将它称为全国总评或其他院校权重；全国适用评分仍待核。品牌创作须知另列为命题要求。",
        "source": 2
      },
      "investment": {
        "text": "全国组委会声明不收参赛费，制作、工具和校内支出不等于全部免费。",
        "source": 0
      }
    },
    "task": "把千问大模型对一种受众的意义转为一张可理解的品牌广告，并交代AI工具如何参与制作。",
    "roles": [
      {
        "name": "创意与文案",
        "task": "从技术决策者、内容创作者或科技兴趣者中选一个受众，写出一个可验证的信息目标",
        "skills": [
          "writing",
          "design"
        ],
        "evidence": "五秒观看后，对方理解的是模型能力还是只记得画面？",
        "output": "本人受众假设、口号备选及盲测反馈"
      },
      {
        "name": "视觉制作",
        "task": "比较两种构图，把品牌主张与工具过程对应",
        "skills": [
          "design"
        ],
        "evidence": "哪些元素由你修改，哪些来自AI原始输出？",
        "output": "分层源文件、工具输出与人工修改版本"
      }
    ],
    "gain": "可形成受众洞察、广告叙事和AI素材溯源作品；并不证明模型真能实现画面中的未来功能。",
    "entry": "先能写一句受众可理解的主张并完成基本排版；不会AI工具者先练素材标注。",
    "completion": "难在把技术概念说清楚而不是堆满未来感图像；合规和传播反馈都要验证。",
    "investment": "编辑建议四周每周4—6小时；不要求购买算力，现有免费额度不可用时先做草图。",
    "fit": [
      "对视觉表达和受众反馈都感兴趣",
      "愿意保留迭代与素材来源"
    ],
    "avoid": [
      "只想生成漂亮图片不愿解释品牌信息",
      "无法取得素材授权"
    ],
    "trial": {
      "action": "画两个千问主题构图，给三名目标受众各看五秒后复述。",
      "output": "两张草图、复述记录与一次修改",
      "check": "记录误解而不是引导对方说正确口号；测试不是营销效果证明。",
      "reflection": "你更愿意改画面还是追问受众为什么误解？"
    },
    "remaining": [
      "全国总评及本人所在院校的平面评分仍待核；本案例仅采用邵阳职业技术学院2026校赛四项尺度作为有来源的训练参考。",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方阿里云题：用AI传播AI的A3平面广告",
      "workedExample": {
        "title": "官方阿里云题：用AI传播AI的A3平面广告",
        "origin": "official_task",
        "sourceIds": [
          "b-ad-rules",
          "b-ad-task",
          "b-ad-shaoyang-2026-reference"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 评分采用邵阳职业技术学院同届校赛公开标准作训练参考，并非证明本稿提交该校或全国评委按相同权重打分。",
        "steps": [
          "从官方三类受众选一类，区分品牌宣传、已证实能力和想象场景。",
          "比较“技术作为幕后支持”与“直接呈现应用结果”两种表达，选一个核心信息。",
          "保留AI输出、人工取舍和版权信息；对三位受众做无提示复述测试。",
          "按竖版、字号、导出与匿名要求检查，说明尚未验证的产品能力和传播效果。 用同届校赛参考四项逐一附证，不计算或预测全国比赛分数。"
        ],
        "reviewQuestions": [
          "画面中的能力是事实还是未来想象？",
          "为什么此受众会关心这句话？",
          "如果去掉品牌标志，核心信息仍能辨认吗？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "同届校赛训练参考：作品创意30%",
          "evidence": "两套受众洞察与口号/构图备选对应一个信息目标，说明为何舍弃另一方案。",
          "official": true,
          "factIds": [
            "national-advertising-art:v2:rubric"
          ]
        },
        {
          "criterion": "同届校赛训练参考：艺术表现30%",
          "evidence": "对照版式层级、配色和五秒复述误读记录，解释视觉取舍；三人反馈不是传播效果证明。",
          "official": true,
          "factIds": [
            "national-advertising-art:v2:rubric"
          ]
        },
        {
          "criterion": "同届校赛训练参考：制作质量30%",
          "evidence": "提供分层源文件、AI原输出与人工修订版本，检查边缘、文字、导出清晰度。",
          "official": true,
          "factIds": [
            "national-advertising-art:v2:rubric"
          ]
        },
        {
          "criterion": "同届校赛训练参考：作品规范10%",
          "evidence": "按真实阿里云题和全国通则核竖版A3、RGB/300dpi/5MB、系列幅数、匿名与素材授权；校赛权重仅参考。",
          "official": true,
          "factIds": [
            "national-advertising-art:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "创意与文案",
          "steps": [
            "从技术决策者、内容创作者或科技兴趣者中选一个受众，写出一个可验证的信息目标",
            "五秒观看后，对方理解的是模型能力还是只记得画面？"
          ],
          "contributionProof": "本人受众假设、口号备选及盲测反馈"
        },
        {
          "role": "视觉制作",
          "steps": [
            "比较两种构图，把品牌主张与工具过程对应",
            "哪些元素由你修改，哪些来自AI原始输出？"
          ],
          "contributionProof": "分层源文件、工具输出与人工修改版本"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "限定受众与广告主张",
          "completionCheck": "写清事实、品牌主张与想象三列"
        },
        {
          "week": 2,
          "action": "完成两版构图并记录AI过程",
          "completionCheck": "每个素材有出处及修改说明"
        },
        {
          "week": 3,
          "action": "做五秒复述测试并迭代",
          "completionCheck": "留下至少一项误解和修改理由"
        },
        {
          "week": 4,
          "action": "导出匿名A3并整理贡献",
          "completionCheck": "他人能定位本人文案或视觉迭代"
        }
      ],
      "exitConditions": [
        "没有可用工具或授权时停在草图，不伪造AI使用记录",
        "若受众只记住装饰，缩减信息后重测"
      ],
      "missingForPublication": [
        "全国阿里云平面路径适用正式评审依据仍未取得；邵阳职院30/30/30/10只作校赛训练参考，不能关闭全国评分缺口。"
      ],
      "requirementMapping": [
        {
          "requirement": "AI创作融合",
          "evidence": "工具及人工修改记录对应每个主要视觉元素",
          "factIds": [
            "national-advertising-art:v2:track"
          ]
        },
        {
          "requirement": "创意性",
          "evidence": "不同口号与构图比较能解释选择",
          "factIds": [
            "national-advertising-art:v2:track"
          ]
        },
        {
          "requirement": "传播性",
          "evidence": "受众复述与误读修订记录",
          "factIds": [
            "national-advertising-art:v2:track"
          ]
        },
        {
          "requirement": "美誉度",
          "evidence": "真实问题与情感价值之间有清晰联系",
          "factIds": [
            "national-advertising-art:v2:track"
          ]
        }
      ]
    }
  },
  {
    "seriesId": "future-designer-ncda",
    "name": "未来设计师·全国高校数字艺术设计大赛",
    "organizer": "未来设计师大赛组委会、浙江中国小商品城集团",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2026-14-yiwu",
    "edition": "2026第14届义乌创新创业赛",
    "groupId": "university-students",
    "group": "普通高校在读本专科生、研究生",
    "scopeId": "china-yiwu-9c1d",
    "scope": "义乌小商品赛9C1D专项规则；不套用非命题组",
    "origin": "legacy_135",
    "trackId": "portable-brush",
    "trackName": "9C1D轻妆随行便携化妆刷",
    "taskFamily": "visual-interaction",
    "subjectDomains": [
      "arts",
      "engineering",
      "management"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-ncda-task",
        "url": "https://www.ncda.org.cn/dsjs/dsnr/mtsd/cxcysd/",
        "title": "2026义乌中国小商品城杯完整命题与评审规则",
        "publisher": "未来设计师大赛组委会、浙江中国小商品城集团",
        "scope": "2026创新创业赛",
        "locator": "竞赛内容9C1D、投稿要求、评审标准、知识产权",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "普通高校在读本专科生、研究生；每件至多3名作者、2名导师，第一作者限投1件。",
        "source": 0
      },
      "track": {
        "text": "9C1D面向移动美妆：手柄须适配16、12、7.3mm管口规格，并考虑便携清洁。",
        "source": 0
      },
      "participation": {
        "text": "平台投稿后按区域现场路演、市场化生产销售、总决赛推进；本题6月10日截稿。",
        "source": 0
      },
      "deliverables": {
        "text": "完整3D设计、统一外包装，A3竖版方案最多5张，另交宣传海报；宣讲视频可选。",
        "source": 0
      },
      "rubric": {
        "text": "官方看主题与规范、原创性、义乌市场及企业工艺适配、批量落地、品牌价值与整体统一；销售数据也进入总决赛评价。",
        "source": 0
      }
    },
    "task": "为高频出行使用者设计便携化妆刷与包装，证明尺寸、制造和成本能同时成立。",
    "roles": [
      {
        "name": "产品结构",
        "task": "比较折叠、伸缩或模块化收纳，核对管口尺寸和清洁路径",
        "skills": [
          "design",
          "engineering"
        ],
        "evidence": "收起来之后刷毛会不会污染，展开是否稳固？",
        "output": "本人尺寸图、纸样或模型与清洁流程对照"
      },
      {
        "name": "成本与使用验证",
        "task": "拆分材料工艺报价，观察携带和使用动作",
        "skills": [
          "research",
          "data-analysis"
        ],
        "evidence": "2—5元是手柄成本还是整套成本？哪些成本仍缺报价？",
        "output": "成本口径表、使用记录和预算敏感性"
      }
    ],
    "gain": "能积累制造约束下的产品设计、成本拆分及商业验证；概念渲染不能证明可以量产。",
    "entry": "会画基本三视图或愿意测量实物即可开始；正式量产需要企业沟通。",
    "completion": "难点是管口通用、卫生清洁和低成本兼容；市场化阶段还要求供货、销售及现场路演。",
    "investment": "编辑建议四周每周4—7小时做模型；报名费原文未明确。应先确认打样和出行预算，以及获奖知识产权归属条款。",
    "fit": [
      "愿意把造型、工艺和使用动作一起考虑",
      "愿意沟通报价与生产条件"
    ],
    "avoid": [
      "只想画效果图，不做尺寸或成本检查",
      "不能接受原文规定的获奖作品知识产权安排"
    ],
    "trial": {
      "action": "测量一支化妆刷，画一个收纳与展开剖面，用纸模模拟。",
      "output": "尺寸图、动作图和污染风险清单",
      "check": "分清题目固定管口与自行设计的外形尺寸。",
      "reflection": "你更喜欢造型、结构还是商业约束？"
    },
    "remaining": [
      "详细企业素材包未完整读取，正式设计还需核对企业最新补充；现有网页题目和评分已读",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方9C1D题：轻妆随行便携化妆刷",
      "workedExample": {
        "title": "官方9C1D题：轻妆随行便携化妆刷",
        "origin": "official_task",
        "sourceIds": [
          "b-ncda-task"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 已披露的使用限制：详细企业素材包未完整读取，正式设计还需核对企业最新补充；现有网页题目和评分已读。该限制仍须在正式参加前核对；历史学习案例不确认当届资格或个人总费用。",
        "steps": [
          "锁定旅行补妆的一条使用路径，分别记录拿取、展开、使用、清洁和收纳。",
          "比较两种结构，按固定管口验证尺寸链；不把握持外形尺寸当管口。",
          "拆分单手柄与多功能件成本，列出材料、工艺、装配及未证实报价。",
          "用纸模验证动作后制作3D方案和统一包装；说明材料卫生和耐用性仍需实测。"
        ],
        "reviewQuestions": [
          "刷毛与包装怎样避免二次污染？",
          "结构是否能用题目给定工艺制造？",
          "包装成本是否被遗漏？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "市场和企业工艺适配",
          "evidence": "尺寸接口、目标场景与制造流程对应",
          "official": true,
          "factIds": [
            "future-designer-ncda:v2:rubric"
          ]
        },
        {
          "criterion": "批量落地",
          "evidence": "材料、装配、报价假设和失效清单",
          "official": true,
          "factIds": [
            "future-designer-ncda:v2:rubric"
          ]
        },
        {
          "criterion": "品牌价值与完整统一",
          "evidence": "产品与包装共用可解释的视觉语言",
          "official": true,
          "factIds": [
            "future-designer-ncda:v2:rubric"
          ]
        },
        {
          "criterion": "原创与规范",
          "evidence": "版本记录及匿名文件审查",
          "official": true,
          "factIds": [
            "future-designer-ncda:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "产品结构",
          "steps": [
            "比较折叠、伸缩或模块化收纳，核对管口尺寸和清洁路径",
            "收起来之后刷毛会不会污染，展开是否稳固？"
          ],
          "contributionProof": "本人尺寸图、纸样或模型与清洁流程对照"
        },
        {
          "role": "成本与使用验证",
          "steps": [
            "拆分材料工艺报价，观察携带和使用动作",
            "2—5元是手柄成本还是整套成本？哪些成本仍缺报价？"
          ],
          "contributionProof": "成本口径表、使用记录和预算敏感性"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "拆解出行补妆流程与尺寸约束",
          "completionCheck": "完成动作和管口清单"
        },
        {
          "week": 2,
          "action": "制作两种纸模并比较收纳",
          "completionCheck": "拍下卡住或污染风险"
        },
        {
          "week": 3,
          "action": "做3D结构及成本拆分",
          "completionCheck": "区分已报价、估计和未知成本"
        },
        {
          "week": 4,
          "action": "合并包装与方案展板",
          "completionCheck": "每个核心卖点都有图或验证依据"
        }
      ],
      "exitConditions": [
        "不能接受知识产权条款就不进入正式投稿",
        "无法取得合理生产报价时标为概念估算，不承诺量产成本"
      ],
      "missingForPublication": [
        "所选9C1D企业详细设计要求PPT及必要素材尚未获取，网页明确指向该附件；不能认定完整官方题已读。"
      ]
    }
  },
  {
    "seriesId": "loreal-brandstorm",
    "name": "L’Oréal Brandstorm",
    "organizer": "L’Oréal",
    "aliases": [],
    "authorAgentId": "/root/research_b",
    "editionId": "2026-luxe",
    "edition": "2026全球Luxe命题",
    "groupId": "18-30-team",
    "group": "18—30岁三人团队",
    "scopeId": "global-local-entry",
    "scope": "全球统一命题；当地资格与截止分别确认",
    "origin": "legacy_135",
    "trackId": "future-fragrance",
    "trackName": "奢华香氛未来体验",
    "taskFamily": "business-practice",
    "subjectDomains": [
      "management",
      "arts",
      "engineering"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-loreal-entry",
        "url": "https://brandstorm2026.loreal.com/en",
        "title": "Brandstorm 2026参赛平台",
        "publisher": "L’Oréal",
        "scope": "2026全球Brandstorm报名基础说明",
        "locator": "参加条件、How it works",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-loreal-brief",
        "url": "https://d32gkk464bsqbe.cloudfront.net/activities/o/BRANDSTORM_2026_MISSION_DOCUMENT.pdf?v=6.8.13",
        "title": "Brandstorm 2026完整命题手册",
        "publisher": "L’Oréal",
        "scope": "2026全球Luxe",
        "locator": "Mission；Submission；Evaluation criteria",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "18—30岁，三人团队，不限学科及经验；当地参赛通道另核验。",
        "source": 0
      },
      "track": {
        "text": "2026命题要求以创意、科学和技术重新设计奢华香氛的产品、服务及体验。",
        "source": 1
      },
      "participation": {
        "text": "报名并提交初选材料，再按当地选拔进入后续赛程；历史2026不表示现在可报。",
        "source": 0
      },
      "deliverables": {
        "text": "3页方案演示文件，另交3分钟团队视频；两者各不超过50MB。",
        "source": 1
      },
      "rubric": {
        "text": "项目5项各5分：创新、可持续、包容、可行、扩展；团队另5项各按5/2/0评分。",
        "source": 1
      }
    },
    "task": "把一种尚未满足的香氛使用需求转成可估算成本、包容不同使用者且能扩大供给的产品或服务。",
    "roles": [
      {
        "name": "需求与商业",
        "task": "观察购买、试香或使用中的一个障碍，建立价值与成本假设",
        "skills": [
          "research",
          "business"
        ],
        "evidence": "需求证据来自真实观察还是团队想象？",
        "output": "本人访谈摘要、反例和成本假设表"
      },
      {
        "name": "体验与验证",
        "task": "绘制服务旅程或原型，用任务测试验证关键环节",
        "skills": [
          "design",
          "communication"
        ],
        "evidence": "没有昂贵硬件时能否先验证体验？",
        "output": "本人流程图、原型版本和测试记录"
      }
    ],
    "gain": "练习把用户问题、体验、商业可行性压缩到三页；不能把概念渲染当成科技已实现。",
    "entry": "先掌握一种用户观察方法和清晰表达；不要求香水专业背景。",
    "completion": "三页同时讲清创新及执行路径较难，团队视频还要用真实经历证明协作。",
    "investment": "编辑建议四周每周4—6小时，优先纸面原型；规则未明确报名收费，不表述为免费。",
    "fit": [
      "喜欢用户需求与商业方案",
      "愿意检验包容性和环境影响"
    ],
    "avoid": [
      "只想讲宏大市场不愿验证关键需求",
      "把尚不存在的技术写成成品"
    ],
    "trial": {
      "action": "画一条试香或购香旅程，找一处障碍并做两种纸面改进。",
      "output": "旅程图、两版方案和取舍理由",
      "check": "区分受访者原话、解释与未经验证的预测。",
      "reflection": "你愿意继续追问成本还是改进体验？"
    },
    "remaining": [],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方2026任务：Craft the Future of Luxury Fragrance",
      "workedExample": {
        "title": "官方2026任务：Craft the Future of Luxury Fragrance",
        "origin": "official_task",
        "sourceIds": [
          "b-loreal-entry",
          "b-loreal-brief"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。",
        "steps": [
          "依据命题在产品、技术或服务切口中选一个具体需求，不扩写成所有人都需要。",
          "用原型检验体验，同时列出包容性受益者与可能被排除的人。",
          "拆开制造或运营成本、价格假设与规模化条件；不把销售预测当事实。",
          "按五项项目标准整理三页，再用真实团队经历回答视频问题。"
        ],
        "reviewQuestions": [
          "改进对谁有价值，又对谁不适用？",
          "扩大十倍供给时哪个约束先失效？",
          "可持续主张有没有基线和测量范围？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "创新5分",
          "evidence": "现有体验比较与不同解决机制",
          "official": true,
          "factIds": [
            "loreal-brandstorm:v2:rubric"
          ]
        },
        {
          "criterion": "可持续及包容各5分",
          "evidence": "环境边界、可达性测试和受益群体",
          "official": true,
          "factIds": [
            "loreal-brandstorm:v2:rubric"
          ]
        },
        {
          "criterion": "可行与扩展各5分",
          "evidence": "成本估算、执行依赖和规模化风险",
          "official": true,
          "factIds": [
            "loreal-brandstorm:v2:rubric"
          ]
        },
        {
          "criterion": "团队五维度",
          "evidence": "真实决策、失败修正及分工经历",
          "official": true,
          "factIds": [
            "loreal-brandstorm:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "需求与商业",
          "steps": [
            "观察购买、试香或使用中的一个障碍，建立价值与成本假设",
            "需求证据来自真实观察还是团队想象？"
          ],
          "contributionProof": "本人访谈摘要、反例和成本假设表"
        },
        {
          "role": "体验与验证",
          "steps": [
            "绘制服务旅程或原型，用任务测试验证关键环节",
            "没有昂贵硬件时能否先验证体验？"
          ],
          "contributionProof": "本人流程图、原型版本和测试记录"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "限定一个真实使用需求和目标受众",
          "completionCheck": "至少记录一个不支持初始想法的观察"
        },
        {
          "week": 2,
          "action": "制作能测试核心体验的低成本原型",
          "completionCheck": "测试结果能改变一处设计"
        },
        {
          "week": 3,
          "action": "估算成本和规模约束",
          "completionCheck": "假设与已知数据分开"
        },
        {
          "week": 4,
          "action": "压缩三页并录团队视频",
          "completionCheck": "每位成员能指出自己的判断与产出"
        }
      ],
      "exitConditions": [
        "没有需求证据时停在探索，不伪造访谈",
        "无法解释关键技术可行性时改用可验证的服务原型"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "intercultural-competence",
    "name": "全国大学生跨文化能力大赛",
    "organizer": "外教社杯辽宁赛区组委会",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2025-liaoning",
    "edition": "2025辽宁赛区中国学生团队现场赛",
    "groupId": "chinese-student-team",
    "group": "中国籍全日制学生三人同校队",
    "scopeId": "liaoning-semifinal",
    "scope": "辽宁赛区复赛；不套用全国决赛评分",
    "origin": "legacy_135",
    "trackId": "case-analysis",
    "trackName": "跨文化案例展析",
    "taskFamily": "language-communication",
    "subjectDomains": [
      "literature",
      "education",
      "interdisciplinary"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-intercultural-rules-case",
        "url": "https://ictvd.oss-cn-beijing.aliyuncs.com/uploadfile/2025/0901/20250901041005540.pdf",
        "title": "2025辽宁现场赛方案及案例撰写参考样例",
        "publisher": "外教社杯辽宁赛区组委会",
        "scope": "2025辽宁中国学生团队",
        "locator": "参赛资格、复赛评分、附件案例An Intercultural Conflict Case—A Chinese Teacher in Poland",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "task": {
        "text": "2025辽宁现场赛方案附件的参考案例描述写 Han Yue 到克拉科夫教育部门办理入职，最终用英语完成手续；住宿时她接受现状，两名英国教师提出卫生、房间与通风问题；端午课堂上她介绍屈原后，学生提出继续生活或移居等不同意见。这些情境出自附件参考案例描述。",
        "source": 0
      },
      "eligibility": {
        "text": "中国籍全日制在校生三人同校组队；英语相关专业至多一人、指导教师至多三人，往届国赛一等奖及以上者受限制。",
        "source": 0
      },
      "track": {
        "text": "辽宁复赛包含英语案例展析、问答和跨文化名言阐释，参考案例不是可直接投稿的原创作品。",
        "source": 0
      },
      "participation": {
        "text": "各校选拔推荐一队；本来源适用2025辽宁现场赛，不代表其他省份通道。",
        "source": 0
      },
      "deliverables": {
        "text": "英语案例展析8—10分钟，问答2分钟，名言阐释2分钟；须按原创要求另写本队案例。",
        "source": 0
      },
      "rubric": {
        "text": "复赛案例展析70分、问答10分、名言阐释20分；后续决赛另有知识、视频和中国故事项目。",
        "source": 0
      }
    },
    "task": "从具体对话和行动分析误解的多种成因，用英语说明解释的证据与改进沟通的办法。",
    "roles": [
      {
        "name": "情境分析",
        "task": "把韩悦故事中的行政沟通、住宿意见和课堂讨论分开",
        "skills": [
          "research",
          "critical-thinking"
        ],
        "evidence": "是文化期待、机构规则、语言困难还是个人偏好？",
        "output": "本人事件证据表和两种竞争解释"
      },
      {
        "name": "英语展析",
        "task": "演示一段原始冲突与改进对话，回答反例质询",
        "skills": [
          "communication",
          "writing"
        ],
        "evidence": "听众能分辨事实、理论和你的推测吗？",
        "output": "本人脚本版本、限时录音与问答记录"
      }
    ],
    "gain": "积累英语案例解释、证据推理与跨文化对话能力；不把国籍当作人的性格说明书。",
    "entry": "能用英语叙述一段具体互动即可开始，理论可以逐个查证。",
    "completion": "难点在保留多种解释，并在有限时间内证明建议为何适合此场景。",
    "investment": "编辑建议四周每周3—5小时；报名及旅行费用未明确，不能推定免费。",
    "fit": [
      "愿意反思自己的第一印象",
      "喜欢语言表达与人际情境分析"
    ],
    "avoid": [
      "想套国家性格标签快速下结论",
      "把官方参考案例改名冒充原创参赛"
    ],
    "trial": {
      "action": "读参考案例的住宿冲突，为同一行为写出两种可能解释。",
      "output": "事实—解释—待问问题三列表",
      "check": "每个文化解释必须有故事细节，同时保留制度和个人因素。",
      "reflection": "被提出反例时你能否修改解释？"
    },
    "remaining": [
      "来源给出分项分值，但没有更细的统一量表；不虚构权重",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方参考案例：A Chinese Teacher in Poland",
      "workedExample": {
        "title": "官方参考案例：A Chinese Teacher in Poland",
        "origin": "official_task",
        "sourceIds": [
          "b-intercultural-rules-case"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 已披露的使用限制：来源给出分项分值，但没有更细的统一量表；不虚构权重。该限制仍须在正式参加前核对；历史学习案例不确认当届资格或个人总费用。",
        "steps": [
          "逐段标记韩悦在波兰的观察与叙述者解释，不把教材样例中的概括自动视为事实。",
          "对住宿投诉、课堂质疑或隐私交谈各列两种解释，说明哪条证据能够区分。",
          "将面子协商或刻板印象作为分析工具，避免把“中国人/波兰人都如此”当结论。",
          "演示澄清需求、确认语言与征询边界的替代对话，并准备反例问答。"
        ],
        "reviewQuestions": [
          "对方行为是否也可能由学校制度解释？",
          "改进对话是否要求一方单方面迁就？",
          "哪些解释需要访谈才能确定？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "案例展析70分",
          "evidence": "情境事实、理论解释及替代方案的连贯呈现",
          "official": true,
          "factIds": [
            "intercultural-competence:v2:rubric"
          ]
        },
        {
          "criterion": "问答10分",
          "evidence": "面对反例能区分已知事实与推测",
          "official": true,
          "factIds": [
            "intercultural-competence:v2:rubric"
          ]
        },
        {
          "criterion": "名言阐释20分",
          "evidence": "用具体情境说明含义及适用边界",
          "official": true,
          "factIds": [
            "intercultural-competence:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "情境分析",
          "steps": [
            "把韩悦故事中的行政沟通、住宿意见和课堂讨论分开",
            "是文化期待、机构规则、语言困难还是个人偏好？"
          ],
          "contributionProof": "本人事件证据表和两种竞争解释"
        },
        {
          "role": "英语展析",
          "steps": [
            "演示一段原始冲突与改进对话，回答反例质询",
            "听众能分辨事实、理论和你的推测吗？"
          ],
          "contributionProof": "本人脚本版本、限时录音与问答记录"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "重建案例中各方行动与误解的时间线",
          "completionCheck": "区分四类冲突及已知事实"
        },
        {
          "week": 2,
          "action": "对照两种文化解释及各自缺失的证据",
          "completionCheck": "指出每种解释的缺证"
        },
        {
          "week": 3,
          "action": "改写一段沟通并演练",
          "completionCheck": "同伴能提出不止一种反应"
        },
        {
          "week": 4,
          "action": "限时展示案例分析并回答同伴质疑",
          "completionCheck": "个人台词、证据表和改稿均可追溯"
        }
      ],
      "exitConditions": [
        "只有国籍标签而无情境证据时暂停结论",
        "正式报名必须重新创作自己的案例，不能提交本参考样例"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "ima-management-accounting",
    "name": "IMA校园管理会计案例大赛",
    "organizer": "IMA中国",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2026-27-16",
    "edition": "第十六届2026—2027中国赛",
    "groupId": "same-campus-3-5",
    "group": "同校3—5名本科生或研究生",
    "scopeId": "china-regional",
    "scope": "中国赛区域赛材料标准",
    "origin": "legacy_135",
    "trackId": "carbon-investment",
    "trackName": "碳价决策：新能源企业的投资与战略挑战",
    "taskFamily": "business-practice",
    "subjectDomains": [
      "management",
      "economics"
    ],
    "factStatus": "verified_current",
    "registrationStatus": "unknown",
    "registrationNote": "原文存在当届赛程，个人资格、学校通道及当地截止尚须确认；本草稿不标当前可报。",
    "sources": [
      {
        "id": "b-ima-rules",
        "url": "https://casecompetition.imachina.org.cn/details/100.html",
        "title": "第十六届比赛规则",
        "publisher": "IMA中国",
        "scope": "2026—2027中国赛",
        "locator": "参赛资格、队伍要求",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-ima-delivery",
        "url": "https://casecompetition.imachina.org.cn/details/102.html",
        "title": "第十六届区域赛材料要求",
        "publisher": "IMA中国",
        "scope": "2026—2027中国赛",
        "locator": "视频、PPT、提交日期",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-ima-case",
        "url": "https://casecompetition.imachina.org.cn/Uploads/Picture/2026/10/27/u6ae04e27dbd7d.pdf",
        "title": "第十六届官方案例：碳价决策",
        "publisher": "IMA中国",
        "scope": "2026—2027中国赛",
        "locator": "6页案例正文、数据表、案例要求",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-ima-16-handbook",
        "url": "https://casecompetition.imachina.org.cn/details/136.html",
        "title": "第十六届IMA校园管理会计案例大赛完整赛事手册",
        "publisher": "IMA中国",
        "scope": "第十六届2026—2027中国赛；校内选拔数量表述与规则网页有差异",
        "locator": "完整9页；第5页要求、第6页校内赛选拔；不含内容评分分值表",
        "authority": "organizer",
        "checkedAt": "2026-11-06",
        "retrievedAt": "2026-11-06",
        "publishedAt": "2026-09-29",
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch03/reading-log.json"
      },
      {
        "id": "b-ima-fourth-reference-rubric",
        "url": "https://ck.zjgsu.edu.cn/_upload/article/files/27/da/d1ca938a4887a39eca6f400d13a0/4f89c4a4-e777-4a9e-86c8-3fdf5451bbe1.pdf",
        "title": "第四届IMA案例大赛2013—2014手册与历史评分",
        "publisher": "IMA主办手册（浙江工商大学托管）",
        "scope": "2013—2014第四届初赛评分，仅作跨届训练参考，不适用于2026—2027正式计分",
        "locator": "PDF完整22页；第1页届次日期、第8页2.4初赛评分；正文页码1—16后附往届案例",
        "authority": "university_local",
        "checkedAt": "2026-11-06",
        "retrievedAt": "2026-11-06",
        "publishedAt": "2013-09-12",
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch03/reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "同校3—5名本科生或研究生组队，不限专业、不要求CMA会员；每校区域赛至多5队。",
        "source": 0
      },
      "track": {
        "text": "研究虚构企业锂航的设备投资，在题设碳价与财务条件下比较A、B方案。 案例题要求分别计算不含及包含碳价的回收期和NPV、说明A/B决策，并披露AI使用与人工复核；这些是题目要求，不是已取得正式评分细则。",
        "source": 2
      },
      "participation": {
        "text": "每校区域赛至多5队。规则页要求同校报名超过5队时组织校内选拔；同届手册第6页写队伍数量满足5支自动进入校内赛阶段。恰好5队的边界表述不一致，须确认学校当届安排，不能据此断言免校赛或无条件必经。区域赛提交窗口2027年1月1日至2月24日。",
        "source": [
          0,
          1,
          3
        ]
      },
      "deliverables": {
        "text": "全员参与的英文陈述视频不超20分钟，配中文字幕；英语PPT的PDF不超15MB，匿名学校。",
        "source": 1
      },
      "rubric": {
        "text": "当前材料合规处罚见第十六届提交要求，当前内容分值未公开读取。训练另参考IMA2013—2014第四届初赛评分：案例分析70分（问题识别10、逻辑分析10、管理会计应用15、定量定性结合15、合理方案10、可行计划10），演示文稿30分（格式、语言、内容组织各10）。这是跨届历史参考，不能据此推算第十六届区域赛得分。",
        "source": [
          1,
          4
        ]
      }
    },
    "task": "把设备投资、税、折旧、残值、补贴与碳成本放进一致现金流模型，解释方案排序为何变化。",
    "roles": [
      {
        "name": "现金流模型",
        "task": "建立有无碳价的两方案现金流并检查时间点",
        "skills": [
          "data-analysis",
          "finance"
        ],
        "evidence": "折旧是现金支出还是所得税抵扣依据？",
        "output": "本人参数字典、公式版本与逐项核对"
      },
      {
        "name": "战略与复核",
        "task": "挑战折现率和碳价假设，审查AI辅助步骤",
        "skills": [
          "critical-thinking",
          "communication"
        ],
        "evidence": "排序是稳健结论还是一项假设造成？",
        "output": "本人敏感性分析、AI错误记录与修正说明"
      }
    ],
    "gain": "练习管理会计、投资比较与可复核建模；本题是虚构教学案例，不是实际投资建议。",
    "entry": "先会电子表格与现金流时间轴，再补税后NPV基础。",
    "completion": "关键不是只报一个数，而是避免亿元/万元、年初/年末及折旧口径混用。",
    "investment": "编辑建议四周每周4—6小时；优先现有表格工具，AI不可用时保留手工模型并核正式任务要求，费用另核。",
    "fit": [
      "喜欢核对假设和财务解释",
      "愿意公开模型错误及修正"
    ],
    "avoid": [
      "只复制AI计算结果不验算",
      "不愿解释现金与会计利润的区别"
    ],
    "trial": {
      "action": "只画两方案十年现金流时间轴，将每项成本、残值和补贴放到相应时点。",
      "output": "现金流时间轴与待确认口径清单",
      "check": "先核单位和税务口径，不急于给投资结论。",
      "reflection": "你是否愿意找出一处可能重复计入的成本？"
    },
    "remaining": [
      "第十六届正式内容评分表仍待核；采用第四届历史官方初赛尺度作为明确跨届训练参考，不称当届适用分值。",
      "同届手册“满足5支”和规则页“超过5队”的校内赛触发边界冲突；保留未知并确认本校安排。",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方第十六届案例：锂航新能源的碳价投资决策",
      "workedExample": {
        "title": "官方第十六届案例：锂航新能源的碳价投资决策",
        "origin": "official_task",
        "sourceIds": [
          "b-ima-rules",
          "b-ima-delivery",
          "b-ima-case",
          "b-ima-16-handbook",
          "b-ima-fourth-reference-rubric"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 案例是第十六届完整命题；内容评价仅用2013—2014第四届官方初赛评分作跨届参考，既非第十六届正式权重，也不预测比赛得分。",
        "steps": [
          "从原题建立参数字典，保留原单位并统一计算单位，标清补贴及残值时间点。",
          "分别计算两方案在无碳价与含碳价下的税后现金流、回收期和NPV；不把折旧直接当现金流出。",
          "用单因素变化检查碳价或折现率改变时的排序，区分题设与现实仍需验证的数据。",
          "仅记录真实发生的AI辅助，逐个核验公式与结论；再用英语解释为何选择及何时反转。"
        ],
        "reviewQuestions": [
          "补贴是否在正确时点且避免重复计算？",
          "碳成本与所得税处理是否一致？",
          "AI给出的公式与题设是否相符？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "历史训练参考：问题识别10、逻辑分析10",
          "evidence": "先列A/B方案的财务、碳价与战略问题，再用同口径现金流说明因果；遗漏项与待确认口径必须可见。",
          "official": true,
          "factIds": [
            "ima-management-accounting:v2:rubric"
          ]
        },
        {
          "criterion": "历史训练参考：管理会计应用15、定量定性结合15",
          "evidence": "对照税后现金流、折旧税盾、NPV/回收期与题设战略约束，保留计算式和敏感性分析，不让AI代替核算。",
          "official": true,
          "factIds": [
            "ima-management-accounting:v2:rubric"
          ]
        },
        {
          "criterion": "历史训练参考：合理方案10、可行计划10",
          "evidence": "解释排序及反转边界，列实施阶段、责任分工与验证数据；只在题设范围提出建议。",
          "official": true,
          "factIds": [
            "ima-management-accounting:v2:rubric"
          ]
        },
        {
          "criterion": "历史训练参考：文稿格式10、语言10、组织10",
          "evidence": "用英文按问题—数据—模型—建议组织材料，并按第十六届真实20分钟/15MB/匿名要求检查；不套用第四届提交格式。",
          "official": true,
          "factIds": [
            "ima-management-accounting:v2:rubric"
          ]
        },
        {
          "criterion": "第十六届材料合规处罚",
          "evidence": "核视频与PDF格式、全员参与和学校匿名；不合规会扣分，具体扣分值未取得。",
          "official": true,
          "factIds": [
            "ima-management-accounting:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "现金流模型",
          "steps": [
            "建立有无碳价的两方案现金流并检查时间点",
            "折旧是现金支出还是所得税抵扣依据？"
          ],
          "contributionProof": "本人参数字典、公式版本与逐项核对"
        },
        {
          "role": "战略与复核",
          "steps": [
            "挑战折现率和碳价假设，审查AI辅助步骤",
            "排序是稳健结论还是一项假设造成？"
          ],
          "contributionProof": "本人敏感性分析、AI错误记录与修正说明"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "读取案例并建参数字典",
          "completionCheck": "所有数值有页码和单位"
        },
        {
          "week": 2,
          "action": "建立与案例时点一致的基础现金流表",
          "completionCheck": "与独立手算样段一致"
        },
        {
          "week": 3,
          "action": "加入碳价并做敏感性检查",
          "completionCheck": "能解释一次排序变化或稳定性"
        },
        {
          "week": 4,
          "action": "形成英文讲解和个人贡献附件",
          "completionCheck": "每个公式和判断都有责任人"
        }
      ],
      "exitConditions": [
        "无法解释公式时退回单期现金流，不提交黑盒结果",
        "没有实际使用AI时不能编造对话或复核记录"
      ],
      "missingForPublication": [
        "第16届2026—2027区域赛适用正式内容评审依据仍缺；第4届70/30仅历史参考，不能据此关闭本届评分缺口。"
      ],
      "requirementMapping": [
        {
          "requirement": "题设财务分析要求",
          "evidence": "四种情形模型与现金流口径可复核",
          "factIds": [
            "ima-management-accounting:v2:track"
          ]
        },
        {
          "requirement": "投资和战略比较",
          "evidence": "排序、边界及关键假设解释",
          "factIds": [
            "ima-management-accounting:v2:track"
          ]
        },
        {
          "requirement": "AI与人工协同要求",
          "evidence": "真实提示词、复核点及失败案例",
          "factIds": [
            "ima-management-accounting:v2:track"
          ]
        }
      ]
    },
    "eligibilityFacts": [
      {
        "idSuffix": "school-selection",
        "text": "第十六届每校区域赛至多5队；同届规则页和手册对恰好5队是否进入校内赛表述不同，具体校内选拔安排待确认。",
        "sourceIds": [
          "b-ima-rules",
          "b-ima-16-handbook"
        ],
        "status": "pending_review"
      }
    ],
    "eligibilityRules": [
      {
        "id": "ima-school-selection-confirmation",
        "field": "priorQualification",
        "operator": "requires_confirmation",
        "value": "本校当届区域赛推荐及必要校内选拔已确认",
        "factIds": [
          "ima-management-accounting:v2:eligibility.school-selection"
        ],
        "note": "学校5名额不等于本人自动获得；恰好5队有原文边界差异，不作硬性人数判定。"
      }
    ]
  },
  {
    "seriesId": "james-dyson-award",
    "name": "James Dyson Award",
    "organizer": "Dyson",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2025-global",
    "edition": "2025届",
    "groupId": "students-recent-graduates",
    "group": "设计工程学生和近期毕业生；细则待补核",
    "scopeId": "2025-national-review",
    "scope": "2025国家/地区评审阶段；作品来自瑞士",
    "origin": "legacy_135",
    "trackId": "engineering-design",
    "trackName": "设计工程发明",
    "taskFamily": "engineering-prototype",
    "subjectDomains": [
      "engineering",
      "arts"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-dyson-rule",
        "url": "https://www.dyson.co.uk/discover/sustainability/james-dyson-award/2025-james-dyson-award-open-for-entries",
        "title": "James Dyson Award 2025 opens for entries",
        "publisher": "Dyson",
        "scope": "2025全球奖项征集与国家阶段评审",
        "locator": "How to enter及2025征集说明",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-dyson-bloc",
        "url": "https://www.jamesdysonaward.org/2025/project/bloc-a-modular-cooling-system-for-public-spaces",
        "title": "bloc°—a modular cooling system for public spaces",
        "publisher": "James Dyson Award作者作品页",
        "scope": "2025瑞士作品",
        "locator": "Function、Inspiration、Design process",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "2025公告面向设计工程学生和近期毕业生；精确毕业年限、团队组成和地区证明细则尚需原始条款补核。",
        "source": 0
      },
      "track": {
        "text": "解决真实问题的设计工程发明；本条读例为公共空间模块化降温装置bloc°。",
        "source": 1
      },
      "participation": {
        "text": "2025在线提交截止7月16日；国家/地区评审后进入全球遴选。",
        "source": 0
      },
      "deliverables": {
        "text": "公开作品页展示问题、功能、启发、设计过程和后续方向；正式上传字段与文件限制另核。",
        "source": 1
      },
      "rubric": {
        "text": "2025国家评审维度：功能、设计过程、差异化、商业可行性。",
        "source": 0
      }
    },
    "task": "把降温概念拆成热湿条件、材料、气流、水和供电约束，用小样说明何时有效、何时失效。",
    "roles": [
      {
        "name": "实验与测量",
        "task": "比较干湿陶土在相同环境中的温度和耗水变化",
        "skills": [
          "engineering",
          "data-analysis"
        ],
        "evidence": "降温来自蒸发、风速还是环境本身变化？",
        "output": "本人对照试验原始数据与环境记录"
      },
      {
        "name": "产品系统",
        "task": "评估公共空间安装、补水、清理及维修路径",
        "skills": [
          "design",
          "research"
        ],
        "evidence": "谁会承担长期维护成本？",
        "output": "本人使用路径、维护清单与结构草图"
      }
    ],
    "gain": "练习把完整作品拆成可检验工程主张，理解用户、环境和维护系统；作者性能不能直接移植到另一城市。",
    "entry": "先能记录温湿度和控制变量；不要求复制整台装置。",
    "completion": "难点是蒸发降温依赖湿度和风，且可持续方案仍有水、电、材料与维护成本。",
    "investment": "编辑建议四周每周4—6小时；先做安全低成本小样，不开展电气改装或公共设施安装；参赛费用未核明。",
    "fit": [
      "喜欢物理验证与产品设计",
      "愿意保留失败和耗水数据"
    ],
    "avoid": [
      "只引用最大降温数字",
      "希望四周即可交付城市基础设施"
    ],
    "trial": {
      "action": "为bloc°的蒸发、供水、供电和维护画一张约束图。",
      "output": "能量/水流图及两个失败情境",
      "check": "所有性能数字标为作者自述，不写成独立验证结果。",
      "reflection": "你愿意测量环境还是研究使用维护？"
    },
    "remaining": [
      "2025完整资格细则与上传格式未完整读取，不能据此确认本人报名资格",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "2025公开完整作品：bloc°模块化公共空间降温系统",
      "workedExample": {
        "title": "2025公开完整作品：bloc°模块化公共空间降温系统",
        "origin": "published_work",
        "sourceIds": [
          "b-dyson-rule",
          "b-dyson-bloc"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。",
        "steps": [
          "读作者的VR空间试验与陶土材料迭代，区分设计活动、测试结论和未公开原始数据。",
          "选择蒸发降温一个机制做小样对照，记录温湿度、时间、风与用水，避免直接复刻整机。",
          "比较低湿、高湿或补水不足条件，解释为何同一概念可能效果不同。",
          "将实验结论连到安装与维护成本，列出尚不能支持的商业及环境主张。"
        ],
        "reviewQuestions": [
          "有无同步对照足以排除天气变化？",
          "耗水和能源边界是否覆盖完整运行？",
          "材料选择兼顾孔隙、强度和清洁吗？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "功能",
          "evidence": "控制变量的试验与环境适用范围",
          "official": true,
          "factIds": [
            "james-dyson-award:v2:rubric"
          ]
        },
        {
          "criterion": "设计过程",
          "evidence": "VR/结构/材料取舍及失败版本",
          "official": true,
          "factIds": [
            "james-dyson-award:v2:rubric"
          ]
        },
        {
          "criterion": "差异化",
          "evidence": "与遮阳、风扇等替代方案比较",
          "official": true,
          "factIds": [
            "james-dyson-award:v2:rubric"
          ]
        },
        {
          "criterion": "商业可行性",
          "evidence": "安装维护责任及成本假设",
          "official": true,
          "factIds": [
            "james-dyson-award:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "实验与测量",
          "steps": [
            "比较干湿陶土在相同环境中的温度和耗水变化",
            "降温来自蒸发、风速还是环境本身变化？"
          ],
          "contributionProof": "本人对照试验原始数据与环境记录"
        },
        {
          "role": "产品系统",
          "steps": [
            "评估公共空间安装、补水、清理及维修路径",
            "谁会承担长期维护成本？"
          ],
          "contributionProof": "本人使用路径、维护清单与结构草图"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "拆解公开作品证据链",
          "completionCheck": "标明作者主张与缺失原始数据"
        },
        {
          "week": 2,
          "action": "设计一个低风险对照",
          "completionCheck": "统一环境与测量时点"
        },
        {
          "week": 3,
          "action": "完成小样并检查反例",
          "completionCheck": "保留异常和失败数据"
        },
        {
          "week": 4,
          "action": "写工程与维护说明",
          "completionCheck": "个人试验或设计贡献可追溯"
        }
      ],
      "exitConditions": [
        "缺少可靠测量条件时停在实验设计，不宣称降温效果",
        "没有场地许可时不安装公共原型"
      ],
      "missingForPublication": [
        "2025完整资格细则与上传格式未完整读取，不能据此确认本人报名资格",
        "规则与bloc°作品原站本轮curl及普通Chrome均403，未获得可独立核查的完整作品图文与适用资格原件；校方简介不能替代完整作品。"
      ]
    }
  },
  {
    "seriesId": "if-student-award",
    "name": "iF DESIGN STUDENT AWARD",
    "organizer": "iF Design",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2025-entry-guide",
    "edition": "2025届官方参赛指南",
    "groupId": "design-students-graduates",
    "group": "设计相关学生及毕业两年内者，团队至多4人",
    "scopeId": "global-2025",
    "scope": "2025全球；MASHAV为指南示例而非当届获奖认定",
    "origin": "legacy_135",
    "trackId": "sdg-design",
    "trackName": "联合国可持续发展目标概念设计",
    "taskFamily": "visual-interaction",
    "subjectDomains": [
      "arts",
      "engineering",
      "interdisciplinary"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-if-guide",
        "url": "https://assets.ctfassets.net/9el74s703hin/mEuiHUwteSLEZbLDQT7VR/c2ca102a428805da3c6d37fdf411d845/iF_DESIGN_STUDENT_AWARD_2025_Entry_Guide_Spanish.pdf",
        "title": "iF DESIGN STUDENT AWARD 2025 Entry Guide（西语）",
        "publisher": "iF Design",
        "scope": "2025全球学生奖参赛与展示规范",
        "locator": "资格、投稿说明、Evaluation criteria及第5页示范海报",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "task": {
        "text": "2025官方指南第5页的MASHAV示范海报描述两件式服装，由裙装与通风风帽组成，并标示被动冷却、主动冷却和组合气流三种图示。以上是海报的设计说明，不证明实测降温效果，也不认定为2025当届获奖作品。",
        "source": 0
      },
      "eligibility": {
        "text": "设计相关专业在校生或毕业两年内者；团队最多4人，2025年2月5日截止。",
        "source": 0
      },
      "track": {
        "text": "围绕SDG1—15提交产品、服务、沟通或应用概念；用官方指南MASHAV完整海报练习证据阅读。",
        "source": 0
      },
      "participation": {
        "text": "英文在线提交；指南声明参赛免费，不包括自主制作和其他支出。",
        "source": 0
      },
      "deliverables": {
        "text": "A1横版一页PDF海报不超5MB，最多2张图及650字符说明，视频可选；以原指南格式为准。",
        "source": 0
      },
      "rubric": {
        "text": "五维：解决问题、伦理标准、团结互助、积极体验、经济可行性；不另编分值。",
        "source": 0
      }
    },
    "task": "把可持续设计概念的用户、工作机制、体验和资源约束讲清楚，并区分海报表达与实际效能验证。",
    "roles": [
      {
        "name": "机制与证据",
        "task": "读MASHAV气流图，重建两件式服装（裙装与通风风帽）的通风逻辑",
        "skills": [
          "design",
          "engineering"
        ],
        "evidence": "被动和主动通风各依赖什么条件？",
        "output": "本人机制重绘与待测参数清单"
      },
      {
        "name": "体验与传播",
        "task": "比较穿脱、活动、舒适和维护的用户路径",
        "skills": [
          "research",
          "communication"
        ],
        "evidence": "海报上的穿着照片能证明舒适吗？",
        "output": "本人体验脚本、信息层级和反例清单"
      }
    ],
    "gain": "学习用一页图解释设计机制并评估社会价值；不把指南示例称为2025获奖作品。",
    "entry": "能画因果箭头和用户动作即可开始，不必先购买智能织物。",
    "completion": "难点是把美观图示连到可测的舒适、能耗、耐用和维护假设。",
    "investment": "编辑建议四周每周3—5小时；2025参赛费明确为零，制作测试预算另计。",
    "fit": [
      "喜欢把科学机制转为清楚视觉表达",
      "愿意质疑海报未展示的性能"
    ],
    "avoid": [
      "只靠SDG图标证明社会价值",
      "把示例作品复刻后作为原创参赛"
    ],
    "trial": {
      "action": "重绘MASHAV被动、主动和组合通风三条气流路径。",
      "output": "机制图与三条待验证主张",
      "check": "图上没有的性能不自行补成作者测试结论。",
      "reflection": "你更关心舒适体验还是装置结构？"
    },
    "remaining": [
      "该海报是官方指南示例，未确认作者完整底层试验资料或2025参赛/获奖身份；只据海报作机制评读",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方2025指南中的完整MASHAV可穿戴通风海报",
      "workedExample": {
        "title": "官方2025指南中的完整MASHAV可穿戴通风海报",
        "origin": "published_work",
        "sourceIds": [
          "b-if-guide"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 已披露的使用限制：该海报是官方指南示例，未确认作者完整底层试验资料或2025参赛/获奖身份；只据海报作机制评读。该限制仍须在正式参加前核对；历史学习案例不确认当届资格或个人总费用。",
        "steps": [
          "读海报的两件式服装（裙装与通风风帽）和三种气流模式，标记哪些信息来自图文、哪些只是推断。",
          "按五维标准提出问题：解决何种热舒适障碍、谁能使用、供电与维护是否合理。",
          "用纸面穿脱流程和简化气流模型找最可能失败的环节；这不是复制原作测试数据。",
          "制作独立评读页，注明原作与分析者贡献，列出不能从海报确认的实际效果。"
        ],
        "reviewQuestions": [
          "活动后气流路径是否仍成立？",
          "主动模式的电源与重量由谁承担？",
          "能否以更简单的服装改良达到同一目标？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "解决问题",
          "evidence": "问题、机制及待测条件对应",
          "official": true,
          "factIds": [
            "if-student-award:v2:rubric"
          ]
        },
        {
          "criterion": "伦理和团结",
          "evidence": "受益者、排除风险及尊严考虑",
          "official": true,
          "factIds": [
            "if-student-award:v2:rubric"
          ]
        },
        {
          "criterion": "积极体验",
          "evidence": "穿脱活动与维护的用户路径",
          "official": true,
          "factIds": [
            "if-student-award:v2:rubric"
          ]
        },
        {
          "criterion": "经济可行性",
          "evidence": "材料、电源、维修和生命周期假设",
          "official": true,
          "factIds": [
            "if-student-award:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "机制与证据",
          "steps": [
            "读MASHAV气流图，重建两件式服装（裙装与通风风帽）的通风逻辑",
            "被动和主动通风各依赖什么条件？"
          ],
          "contributionProof": "本人机制重绘与待测参数清单"
        },
        {
          "role": "体验与传播",
          "steps": [
            "比较穿脱、活动、舒适和维护的用户路径",
            "海报上的穿着照片能证明舒适吗？"
          ],
          "contributionProof": "本人体验脚本、信息层级和反例清单"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "阅读原海报并拆解结构",
          "completionCheck": "不添加未经展示的性能数据"
        },
        {
          "week": 2,
          "action": "用五维标准提出反例",
          "completionCheck": "每维至少有一个可检验问题"
        },
        {
          "week": 3,
          "action": "做机制或体验的简化验证",
          "completionCheck": "记录简化验证与真实使用环境的差别"
        },
        {
          "week": 4,
          "action": "完成一页独立评读",
          "completionCheck": "清楚署名原作和本人分析"
        }
      ],
      "exitConditions": [
        "没有实测数据就不宣称降温幅度或健康效果",
        "参赛应重新创作，不能提交指南示例复刻"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "cfa-research-challenge",
    "name": "CFA Institute Research Challenge",
    "organizer": "CFA Institute",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2024-2025-historical",
    "edition": "2024—2025赛季及2025历史完整报告",
    "groupId": "university-team",
    "group": "高校本研代表队（local kickoff时核验）",
    "scopeId": "global-2024-2025-report",
    "scope": "2024—2025全球研究报告规则及同届波兰作品；不套2026—2027报名资格",
    "origin": "legacy_135",
    "trackId": "equity-research",
    "trackName": "股票研究与估值",
    "taskFamily": "business-practice",
    "subjectDomains": [
      "economics",
      "management"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "2024—2025历史赛季，个人训练可阅读公开报告；当前报名、学校通道和资格应另查当届规则。",
    "sources": [
      {
        "id": "b-cfa-2025-rules",
        "url": "https://www.unive.it/web/fileadmin/user_upload/cdl_cdlm/area-economica/research-challenge-official-rules.pdf",
        "title": "CFA Research Challenge 2024–2025 Official Rules",
        "publisher": "CFA Institute；Ca’ Foscari University官方赛事页面托管",
        "scope": "2024—2025赛季全球规则及同届书面报告评分",
        "locator": "第1—8页总则资格研究与报告、第15页报告格式、第17—18页评分；PDF封面明确2024–2025",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/gap-repair-reading-log.json"
      },
      {
        "id": "b-cfa-report",
        "url": "https://www.cfainstitute.org/sites/default/files/docs/insights/events/research-challenge/rc-2025-winning-written-report-kozminski-university.pdf",
        "title": "2025 Kozminski University完整获奖研究报告",
        "publisher": "CFA Institute",
        "scope": "CFA官网公开的2025 Kozminski作者报告；属于作品证据，不是资格规则",
        "locator": "投资摘要、估值、风险、敏感性及附录",
        "authority": "other",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "学校位于所属本地赛区域，kickoff时由同校本科或研究生组成3—5人队，至少达到学校定义的非全日制课程负荷；之后毕业仍可继续。此前参加并已交本地报告者、曾或现核心投资管理从业者（纯实习例外）、CFA持证人、CFA或当地举办方雇员等不可参加；纪律、行为和不能化解的利益冲突限制须逐项核对，不能只凭专业判资格。",
        "source": 0
      },
      "participation": {
        "text": "高校组队经本地主办方选定，依本地、次区域、区域半决赛、区域、全球赛推进；正式注册应在本地kickoff后两周内完成，学校队伍和主办方接纳不自动保证。",
        "source": 0
      },
      "track": {
        "text": "研究本地主办方指定上市公司，以独立研究分析师视角形成原创研究；只用公开信息，引用既有研究须标出处，AI使用须披露且不能冒称自己创作。",
        "source": 0
      },
      "deliverables": {
        "text": "英文原创报告主文不超过10页A4（不含规定封面），附录不超过10页；写公司、行业、摘要、估值、财务、风险、ESG及注明日期的价格建议，并作比赛展示；报告与展示评分分别适用。",
        "source": 0
      },
      "rubric": {
        "text": "2024—2025书面评分100分：公司5、行业10、摘要15、估值20、财务20、风险15、ESG15；本地/区域/全球展示另按财务20、估值20、ESG10、表达20、问答20、团队5、材料5评分，不混成同一张表。",
        "source": 0
      }
    },
    "task": "追溯研究报告中经营假设如何进入现金流和估值，再检查最能改变结论的风险。",
    "roles": [
      {
        "name": "财务与估值",
        "task": "重建一段收入、利润和折现逻辑，核对数据时点",
        "skills": [
          "finance",
          "data-analysis"
        ],
        "evidence": "目标价变化究竟来自增长、利润率还是折现率？",
        "output": "本人参数来源表、公式与敏感性矩阵"
      },
      {
        "name": "行业与风险",
        "task": "对照报告投资理由和风险，寻找反方证据",
        "skills": [
          "research",
          "critical-thinking"
        ],
        "evidence": "哪个风险足以推翻核心理由而不是装饰性披露？",
        "output": "本人证据摘记、反例和情景说明"
      }
    ],
    "gain": "获得公开信息研究、模型质询与观点表达练习；不据历史报告交易，也不把获奖当预测准确证明。",
    "entry": "先会阅读三张财务报表和折现概念，不要求一开始搭完整模型。",
    "completion": "难点在保持数据日期、单位和假设一致，避免通过调参数迎合目标价。",
    "investment": "编辑建议四周每周5—7小时，使用公开材料；参赛及差旅费用未核明。",
    "fit": [
      "喜欢追溯财务数值来源",
      "愿意主动检验自己观点的反例"
    ],
    "avoid": [
      "只想抄目标价结论",
      "把历史获奖报告当当前交易信号"
    ],
    "trial": {
      "action": "只读历史报告的投资摘要和敏感性段，画出目标价的三个驱动因素。",
      "output": "驱动关系图和数据日期表",
      "check": "将作者建议标为2025历史判断，不外推当前市场。",
      "reflection": "你更愿意核模型还是寻找行业反证？"
    },
    "remaining": [
      "本记录的2024—2025规则与公开报告同届；2026—2027现行规则另存阅读日志，不混用当前资格",
      "费用及当地学校接纳通道未知；规则的利益冲突和经历限制须由主办方落实",
      "研究草稿待两名独立审阅者核验，不构成投资建议"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "2025完整作品：Kozminski团队Dom Development研究报告",
      "workedExample": {
        "title": "2025完整作品：Kozminski团队Dom Development研究报告",
        "origin": "published_work",
        "sourceIds": [
          "b-cfa-2025-rules",
          "b-cfa-report"
        ],
        "sourceBoundary": "使用封面明确2024—2025的完整规则第17页书面评分评读同届2025 Kozminski公开报告；本包以已冻结的学校托管同届规则原件为据。现行2026—2027规则不用于本例资格或评分；下列复算与四周练习是编辑方案，不是官方答案。",
        "steps": [
          "锁定2025年1月31日历史时点，区分公司披露、作者预测和模型输出。",
          "读DCF和WACC/终值增长矩阵，重建一个输入变化到估值变化的路径。",
          "对照牛熊情景与蒙特卡洛，检查变量独立性和分布假设，而不只重复模拟次数。",
          "用同届2024—2025第17页书面评分整理独立评读，分别检查公司、行业、摘要、估值、财务、风险和ESG，明确未复核全部底层模型，也不将历史目标价当当前建议。"
        ],
        "reviewQuestions": [
          "情景变化是否同时改变多个相互关联变量？",
          "ESG调整是否有可复核依据？",
          "风险能否直接连到现金流或折现率？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "估值20与财务20：2024—2025书面评分",
          "evidence": "输入、计算及模型敏感性可追溯",
          "official": true,
          "factIds": [
            "cfa-research-challenge:v2:rubric"
          ]
        },
        {
          "criterion": "投资摘要15与风险15：2024—2025书面评分",
          "evidence": "论点、反例和结论条件一致",
          "official": true,
          "factIds": [
            "cfa-research-challenge:v2:rubric"
          ]
        },
        {
          "criterion": "行业10与ESG15：2024—2025书面评分",
          "evidence": "公开来源和假设边界",
          "official": true,
          "factIds": [
            "cfa-research-challenge:v2:rubric"
          ]
        },
        {
          "criterion": "公司5：2024—2025书面评分",
          "evidence": "经营模式及收入驱动清晰",
          "official": true,
          "factIds": [
            "cfa-research-challenge:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "财务与估值",
          "steps": [
            "重建一段收入、利润和折现逻辑，核对数据时点",
            "目标价变化究竟来自增长、利润率还是折现率？"
          ],
          "contributionProof": "本人参数来源表、公式与敏感性矩阵"
        },
        {
          "role": "行业与风险",
          "steps": [
            "对照报告投资理由和风险，寻找反方证据",
            "哪个风险足以推翻核心理由而不是装饰性披露？"
          ],
          "contributionProof": "本人证据摘记、反例和情景说明"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "建立历史时点与来源表",
          "completionCheck": "仅使用估值时点以前可获得的信息"
        },
        {
          "week": 2,
          "action": "重建一个估值片段",
          "completionCheck": "能解释公式及单位"
        },
        {
          "week": 3,
          "action": "质询估值情景并检查反向变化的风险",
          "completionCheck": "列出一个可能推翻判断的条件"
        },
        {
          "week": 4,
          "action": "写独立评读与贡献说明",
          "completionCheck": "所有复算与编辑判断可区分"
        }
      ],
      "exitConditions": [
        "无法追溯输入时停止精确目标价复算",
        "不得将练习形成的历史结论包装为当前投资建议"
      ],
      "missingForPublication": []
    },
    "eligibilityRules": [
      {
        "id": "cfa-historical-school",
        "field": "priorQualification",
        "operator": "requires_confirmation",
        "value": "学校队伍及本地主办方接纳、kickoff时同校在读至少part-time课程",
        "factIds": [
          "cfa-research-challenge:v2:eligibility.school-registration"
        ],
        "note": "之后毕业仍可继续，不用当前在读状态替代kickoff时点"
      },
      {
        "id": "cfa-historical-exclusions",
        "field": "priorQualification",
        "operator": "requires_confirmation",
        "value": "核对往届交报告、投资管理就业（纯实习例外）、CFA持证及任职、纪律/行为和利益冲突限制",
        "factIds": [
          "cfa-research-challenge:v2:eligibility"
        ],
        "note": "不能只凭本科或研究生标签确认"
      },
      {
        "id": "cfa-historical-team",
        "field": "teamSize",
        "operator": "requires_confirmation",
        "value": "kickoff时3至5人；换人截止及之后少于3人继续例外见第6页",
        "factIds": [
          "cfa-research-challenge:v2:eligibility"
        ],
        "note": "不把例外误当初始两人可报名"
      }
    ],
    "eligibilityFacts": [
      {
        "idSuffix": "school-registration",
        "text": "2025规则要求当地kickoff时在参赛大学注册至少非全日制课业量，校队须由当地承办方接纳；该历史规定不证明当届校队入口。",
        "sourceIds": [
          "b-cfa-2025-rules"
        ],
        "status": "historical"
      }
    ]
  },
  {
    "seriesId": "market-research-analysis",
    "name": "全国大学生市场调查与分析大赛",
    "organizer": "中国农业大学校赛组委会",
    "aliases": [],
    "authorAgentId": "/root/research_b",
    "editionId": "2025-15-undergraduate",
    "edition": "第十五届2025本科组",
    "groupId": "undergraduate-3-5",
    "group": "通过知识赛的同校本科生3—5人",
    "scopeId": "china-cau-submission",
    "scope": "全国企业题；中国农业大学校赛提交口径",
    "origin": "legacy_135",
    "trackId": "wenjuan-ai",
    "trackName": "问卷网全国企业命题",
    "taskFamily": "investigation",
    "subjectDomains": [
      "management",
      "economics",
      "interdisciplinary"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-market-rules",
        "url": "https://youth.cau.edu.cn/art/2025/1/9/art_45078_1051289.html",
        "title": "第十五届校赛及企业命题赛通知",
        "publisher": "中国农业大学校赛组委会",
        "scope": "2025本科生校赛及企业题",
        "locator": "参赛对象、材料、企业命题安排",
        "authority": "university_local",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-market-task",
        "url": "https://youth.cau.edu.cn/module/download/downfile.jsp?classid=0&filename=87f59d4d9434466aaf043a159b3c445f.xlsx",
        "title": "附件5全国范围企业命题（最终）",
        "publisher": "中国商业统计学会命题企业；农大公开附件",
        "scope": "第十五届全国企业命题",
        "locator": "问卷网-全国范围题工作表B3:H3",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-market-score",
        "url": "https://youth.cau.edu.cn/module/download/downfile.jsp?classid=0&filename=382685a6abf7412497e458faab6c562b.docx",
        "title": "附件4竞赛方式、计分方式及报告评审说明",
        "publisher": "中国商业统计学会；农大公开附件",
        "scope": "第十五届本科组评分",
        "locator": "本科组报告打分表及逐项说明",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "本科组为知识赛通过者，同校3—5名本科生、1—3导师，一人一队。",
        "source": 0
      },
      "track": {
        "text": "问卷网企业题研究AI对在线问卷平台影响；问卷网为必选平台，样本人群不可只限高校。",
        "source": 1
      },
      "participation": {
        "text": "经过学校遴选推荐；农大校赛2025年3月12日17时截止，不能套用为全国个人截止。",
        "source": 0
      },
      "deliverables": {
        "text": "报告正文至多2万字，另有承诺书、PPT和农大校赛8分钟内展示视频；任务必须含网络定量调查。",
        "source": [
          0,
          1
        ]
      },
      "rubric": {
        "text": "本科报告100分：选题10、文献7、方案20、实施20、分析结论25、文本15、创新3；不同赛段合成比例不同。",
        "source": 2
      }
    },
    "task": "调查真实平台使用者如何使用或拒绝AI功能，把可复核调查转成产品需求与改进优先级。",
    "roles": [
      {
        "name": "调查设计",
        "task": "把AI功能体验拆成使用场景、任务、障碍和预期，设计网络抽样",
        "skills": [
          "research",
          "critical-thinking"
        ],
        "evidence": "是否只问到了熟悉技术的学生，遗漏实际工作用户？",
        "output": "本人抽样方案、问卷修订与预测试笔记"
      },
      {
        "name": "数据分析",
        "task": "清理并标记数据质量，比较不同使用经验群体",
        "skills": [
          "data-analysis",
          "writing"
        ],
        "evidence": "体验差异是否由职业、使用频率等因素解释？",
        "output": "本人匿名数据字典、清理脚本与图表解释"
      }
    ],
    "gain": "积累需求研究、抽样质量和证据写作；调查结论不能由AI代替真实受访者生成。",
    "entry": "先会设计不诱导的问题和读基础统计，不必堆复杂模型。",
    "completion": "难点是接触校外真实用户并说明非概率样本的偏差，不能以样本量掩盖抽样问题。",
    "investment": "编辑建议四周每周4—6小时先做小规模试调查；全国报名费及工具费用需按校内通知核对，不假定免费。",
    "fit": [
      "愿意实际联系使用者并修问卷",
      "喜欢让分析回答一个明确产品问题"
    ],
    "avoid": [
      "想用生成问卷答案代替调查",
      "只做校园便利样本却宣称代表全国"
    ],
    "trial": {
      "action": "比较问卷网与另一平台的一项AI流程，写五个中性访谈问题。",
      "output": "任务比较表、问题清单与抽样缺口",
      "check": "按题目包含问卷网，但不预先认定AI必然改善体验。",
      "reflection": "你愿意听用户抱怨而不是推销功能吗？"
    },
    "remaining": [],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方第十五届问卷网题：AI对在线问卷平台的影响与价值",
      "workedExample": {
        "title": "官方第十五届问卷网题：AI对在线问卷平台的影响与价值",
        "origin": "official_task",
        "sourceIds": [
          "b-market-rules",
          "b-market-task",
          "b-market-score"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。",
        "steps": [
          "按官方要求确定平台与非纯高校人群，把“AI有用”拆成可观察任务与评价指标。",
          "预测试问卷，去掉暗示性词语；制定网络调查招募和数据质量规则。",
          "用真实自愿回答完成小样本试调查，记录拒访和来源分布，禁止生成受访数据。",
          "将分析结论对应使用障碍与产品建议，说明无法由当前样本推断的市场范围。"
        ],
        "reviewQuestions": [
          "受访者实际用过所评价功能吗？",
          "反对AI的人是否有机会进入样本？",
          "建议的优先级是否有数据而非偏好支持？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "方案设计20分",
          "evidence": "目标人群、抽样框与问卷逻辑",
          "official": true,
          "factIds": [
            "market-research-analysis:v2:rubric"
          ]
        },
        {
          "criterion": "调查实施20分",
          "evidence": "招募、预测试和质量控制记录",
          "official": true,
          "factIds": [
            "market-research-analysis:v2:rubric"
          ]
        },
        {
          "criterion": "分析与结论25分",
          "evidence": "结论对应真实数据及局限",
          "official": true,
          "factIds": [
            "market-research-analysis:v2:rubric"
          ]
        },
        {
          "criterion": "文本15与创新3分",
          "evidence": "清楚表达和可说明的研究创新",
          "official": true,
          "factIds": [
            "market-research-analysis:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "调查设计",
          "steps": [
            "把AI功能体验拆成使用场景、任务、障碍和预期，设计网络抽样",
            "是否只问到了熟悉技术的学生，遗漏实际工作用户？"
          ],
          "contributionProof": "本人抽样方案、问卷修订与预测试笔记"
        },
        {
          "role": "数据分析",
          "steps": [
            "清理并标记数据质量，比较不同使用经验群体",
            "体验差异是否由职业、使用频率等因素解释？"
          ],
          "contributionProof": "本人匿名数据字典、清理脚本与图表解释"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "拆解企业题并设计抽样",
          "completionCheck": "覆盖校外真实用户的可行路径"
        },
        {
          "week": 2,
          "action": "进行问卷预测试并修正理解歧义",
          "completionCheck": "记录一处误解及修订"
        },
        {
          "week": 3,
          "action": "完成试调查与清理",
          "completionCheck": "原始和清理版本可追溯"
        },
        {
          "week": 4,
          "action": "写出调查建议与样本外推的具体局限",
          "completionCheck": "每项建议对应证据及个人贡献"
        }
      ],
      "exitConditions": [
        "找不到校外样本时只交试调查设计，不声称完成官方调查",
        "不能取得知情同意就不收集可识别个人资料"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "understanding-contemporary-china-foreign-language",
    "name": "外研社·国才杯理解当代中国全国大学生外语能力大赛",
    "organizer": "北京外国语大学、外研社",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2026-english-video",
    "edition": "2026英语组短视频",
    "groupId": "fulltime-undergraduate-masters",
    "group": "全日制本科生与硕士研究生；个人或至多5人同校队",
    "scopeId": "china-ahnu-local",
    "scope": "全国统一主题；安徽师范大学校赛评分",
    "origin": "legacy_135",
    "trackId": "china-through-data",
    "trackName": "数说中国",
    "taskFamily": "language-communication",
    "subjectDomains": [
      "literature",
      "arts",
      "interdisciplinary"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-fltrp-rules",
        "url": "https://ucc.fltrp.com/c/2026-04-15/517928.shtml",
        "title": "2026大赛通知与英语组短视频方案",
        "publisher": "北京外国语大学、外研社",
        "scope": "2026英语组全国统一要求",
        "locator": "参赛资格、作品要求、英语短视频赛项",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-fltrp-local",
        "url": "https://flc.ahnu.edu.cn/info/1090/50391.htm",
        "title": "安徽师范大学2026短视频校赛通知及评分",
        "publisher": "安徽师范大学校赛组织单位",
        "scope": "2026安师大英语短视频校赛",
        "locator": "二（三）评分标准及提交要求",
        "authority": "university_local",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "英语组面向全日制本科和硕士研究生；个人或同校至多5人，一人一作品。 往届同语种同赛项国赛冠、亚、季军不得再次参赛。",
        "source": 0
      },
      "track": {
        "text": "2026实际命题“数说中国”：从发展数据切入，以可视化和故事化英语短视频面向国际受众。",
        "source": [
          0,
          1
        ]
      },
      "participation": {
        "text": "校赛、省赛、国赛三级；安师大校赛材料截止8月31日，其他学校另核。",
        "source": 1
      },
      "deliverables": {
        "text": "原创视频不超3分钟，中英双字幕，参赛学生真实英语配音；素材与AI画面按要求标注。",
        "source": 0
      },
      "rubric": {
        "text": "安师大2026校赛：视频内容50%、语言表达30%、制作技术20%；此权重不自动视为所有赛区标准。",
        "source": 1
      }
    },
    "task": "将有来源的数据变成国际受众能理解的英语故事，同时保证统计口径、配音和画面信息一致。",
    "roles": [
      {
        "name": "数据与英语脚本",
        "task": "核对指标年份、单位、分母，写受众可理解的英语叙事",
        "skills": [
          "research",
          "writing"
        ],
        "evidence": "增长率与绝对量是否被混为一谈？",
        "output": "本人数据来源表、英文改稿与术语解释"
      },
      {
        "name": "影像与声音",
        "task": "设计图表镜头并录制真实英语旁白",
        "skills": [
          "design",
          "communication"
        ],
        "evidence": "去掉背景音乐后信息仍清楚吗？",
        "output": "本人分镜、配音原文件与剪辑修改"
      }
    ],
    "gain": "练习数据叙事、英语表达和视听信息设计；漂亮动画不能弥补数据口径错误。",
    "entry": "会查原始统计出处、写简单英语句子即可先做30秒练习。",
    "completion": "难点在三分钟内兼顾背景解释与具体人物或场景，并控制双语字幕负担。",
    "investment": "编辑建议四周每周3—5小时，用已有手机和剪辑工具；费用未明确，不假定免费。",
    "fit": [
      "喜欢英语和数据故事",
      "愿意录音并根据听众误解修改"
    ],
    "avoid": [
      "只想用AI一键生成核心脚本及声音",
      "不愿核查数据出处和素材权利"
    ],
    "trial": {
      "action": "为一个有出处的数据画三镜头，自己录30秒英语旁白。",
      "output": "数据卡、三镜头草图与原声录音",
      "check": "标明年份、分母和来源，不用无出处的大数字。",
      "reflection": "听众能复述数字说明的具体变化吗？"
    },
    "remaining": [
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "2026官方短视频命题：数说中国（China Through Data）",
      "workedExample": {
        "title": "2026官方短视频命题：数说中国（China Through Data）",
        "origin": "official_task",
        "sourceIds": [
          "b-fltrp-rules",
          "b-fltrp-local"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。",
        "steps": [
          "先选官方主题中的一个可核验发展指标，记录时间、地域、统计定义和修订情况。",
          "围绕一条变化写故事，不把相关性说成因果；明确国际受众需要的背景。",
          "制作三分钟内分镜与双语字幕，用本人真实声音配音，核心创作由参赛者完成。",
          "请未读资料的人复述信息，修正误解；检查匿名、引用、AI画面标注和版权。"
        ],
        "reviewQuestions": [
          "图表是否截断坐标造成夸大？",
          "字幕和旁白的单位是否一致？",
          "核心故事是否确由参赛者创作？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "内容50%：安师大校赛",
          "evidence": "主题、数据解释与受众理解",
          "official": true,
          "factIds": [
            "understanding-contemporary-china-foreign-language:v2:rubric"
          ]
        },
        {
          "criterion": "语言30%：安师大校赛",
          "evidence": "真实英语配音、术语与语法",
          "official": true,
          "factIds": [
            "understanding-contemporary-china-foreign-language:v2:rubric"
          ]
        },
        {
          "criterion": "技术20%：安师大校赛",
          "evidence": "清晰画面、声音和镜头关系",
          "official": true,
          "factIds": [
            "understanding-contemporary-china-foreign-language:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "数据与英语脚本",
          "steps": [
            "核对指标年份、单位、分母，写受众可理解的英语叙事",
            "增长率与绝对量是否被混为一谈？"
          ],
          "contributionProof": "本人数据来源表、英文改稿与术语解释"
        },
        {
          "role": "影像与声音",
          "steps": [
            "设计图表镜头并录制真实英语旁白",
            "去掉背景音乐后信息仍清楚吗？"
          ],
          "contributionProof": "本人分镜、配音原文件与剪辑修改"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "锁定一项数据变化与视频目标受众",
          "completionCheck": "每个数值可追溯原出处"
        },
        {
          "week": 2,
          "action": "将数据来源和核心变化写入脚本分镜",
          "completionCheck": "同伴能理解一条核心变化"
        },
        {
          "week": 3,
          "action": "拍摄配音并剪初版",
          "completionCheck": "素材与声音保留原件"
        },
        {
          "week": 4,
          "action": "测试观众理解并修订视频中的误导表述",
          "completionCheck": "三分钟内完成合规检查"
        }
      ],
      "exitConditions": [
        "无法核查数据就换指标，不编造统计",
        "旁白须由参赛学生真实英语配音，不使用AI语音；AI生成画面按短视频赛道要求标注，并核对原创及素材授权，不套用四新研究报告的AIGC核心创作禁令"
      ],
      "missingForPublication": [
        "尚无具体完整官方题例或完整公开短视频作品；开放主题与通用创作流程不能代替严格L3案例。"
      ]
    },
    "eligibilityFacts": [
      {
        "idSuffix": "prior-awards",
        "text": "往届本赛事国赛冠、亚、季军不得再次参加同语种同赛项。",
        "sourceIds": [
          "b-fltrp-rules"
        ],
        "status": "historical"
      }
    ],
    "eligibilityRules": [
      {
        "id": "fltrp-prior-awards",
        "field": "priorQualification",
        "operator": "requires_confirmation",
        "value": "未获得往届同语种同赛项国赛冠、亚、季军",
        "factIds": [
          "understanding-contemporary-china-foreign-language:v2:eligibility.prior-awards"
        ],
        "note": "须核对本人往届成绩，学籍及人数不替代该限制"
      }
    ]
  },
  {
    "seriesId": "national-college-industrial-design",
    "name": "全国大学生工业设计大赛",
    "organizer": "黑龙江省普通高等学校创新创业教育指导委员会",
    "aliases": [],
    "authorAgentId": "/root",
    "editionId": "2024-7",
    "edition": "2024第七届历史读例",
    "groupId": "fulltime-university",
    "group": "普通高校全日制学生，含研究生和高职高专",
    "scopeId": "heilongjiang-rules-national-work",
    "scope": "黑龙江省赛规则；全国公开展板作跨赛区评读",
    "origin": "legacy_135",
    "trackId": "product-system",
    "trackName": "产品与使用系统设计（学习主题）",
    "governanceFactField": "eligibility",
    "taskFamily": "engineering-prototype",
    "subjectDomains": [
      "arts",
      "engineering"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-industrial-rule",
        "url": "https://arch.hit.edu.cn/_upload/article/files/ee/e4/13a9400d4b9189d376c73be3b166/e8624474-d7df-46aa-9343-ad9ba91ff0bf.pdf",
        "title": "2024全国工业设计黑龙江赛区通知",
        "publisher": "黑龙江省普通高等学校创新创业教育指导委员会",
        "scope": "2024黑龙江省赛区规则",
        "locator": "参赛对象、作品提交、五项评审标准",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": "2024-07-02",
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch03/reading-log.json"
      },
      {
        "id": "b-industrial-work",
        "url": "https://www.gdep.edu.cn/__local/7/DB/0D/045B0FC787464C7A103EAE08495_1FD490AC_7AB15B.pdf",
        "title": "导读2025第1期：完整工业设计优秀展板",
        "publisher": "广东工程职业技术学院图书馆",
        "scope": "公开转载2024作品，不推断原始测试",
        "locator": "PDF第44页（印刷页42），Empty完整展板",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch03/reading-log.json"
      }
    ],
    "verified": {
      "task": {
        "text": "公开转载的Empty户外多功能灶具展板展示可拖动箱体，并描述运输与使用形态转换：冰箱向一侧滑出并翻出下方支架，打开盖板后将两片桌板装到两侧；灶具可单独拿出摆放。这是公开展板中的设计说明，不证明制造尺寸、安全实测或黑龙江赛区参赛身份。",
        "source": 1
      },
      "investment": {
        "text": "2024 黑龙江赛区通知明确由参赛单位承担展板制作费。作品入围国赛后，模型寄送和收回费用也由参赛单位承担。",
        "source": 0
      },
      "eligibility": {
        "text": "2024黑龙江赛区面向普通高校全日制研究生、本科生、高职高专，学校集体报名。",
        "source": 0
      },
      "track": {
        "text": "2024 黑龙江赛区将作品分为 A 智慧与体验、B 服务与系统、C 文化与社会、D 时尚与生活、E 健康与环保及 F 专项赛。这里用全国公开的 Empty 户外灶具展板学习产品结构和使用系统，资料未说明这件作品属于哪个黑龙江省赛类别。",
        "source": [0, 1]
      },
      "participation": {
        "text": "黑龙江赛区2024年6月22日至7月30日网上报名，学校汇总材料交分赛区组委会；由分赛区评审委员会评选35件优秀作品推荐全国复评。",
        "source": 0
      },
      "deliverables": {
        "text": "将设计草图、设计说明、预想图、模型照片等编排为一张纵向1089×841mm JPG图版，150dpi且不超5MB；另按官网模板提交单独的作品设计说明，并由学校汇总报送作品信息汇总表等材料。",
        "source": 0
      },
      "rubric": {
        "text": "黑龙江省赛五项：作品表现、创造性、实用性、经济性、环保性；仅用作同届训练尺度，不追认原作获奖评分。",
        "source": 0
      }
    },
    "task": "从完整产品展板检验收纳、展开、操作和维护的逻辑，再区分造型表达与工程可行性。",
    "roles": [
      {
        "name": "结构与动作",
        "task": "重建推箱、滑出冰箱、展桌与取灶的动作顺序",
        "skills": [
          "design",
          "engineering"
        ],
        "evidence": "哪个部件需要先展开，是否产生干涉或倾倒？",
        "output": "本人动作图、纸模与失败照片"
      },
      {
        "name": "用户与成本",
        "task": "比较家庭和个人露营需求，列材料运输维护约束",
        "skills": [
          "research",
          "business"
        ],
        "evidence": "多功能是否增加了使用者不愿承担的重量？",
        "output": "本人需求取舍表和成本/重量假设"
      }
    ],
    "gain": "练习读完整工业设计图版，提出具体可测试的反例；渲染图不能证明燃烧或承重安全。",
    "entry": "从纸板结构与简单尺寸关系开始；不要求制作真实灶具。",
    "completion": "难在机械干涉、重心、重量和清洁成本与视觉简洁之间做取舍。",
    "investment": "编辑建议四周每周4—6小时，仅做无燃料结构模型。展板及入围模型寄送的具体金额、学生是否垫付、学校如何报销及差旅安排，须向本校负责部门确认。",
    "fit": [
      "喜欢拆解真实物件的使用顺序",
      "愿意用模型发现图上看不到的问题"
    ],
    "avoid": [
      "把效果图当成制造图",
      "计划自行改造燃气系统验证概念"
    ],
    "trial": {
      "action": "根据Empty展板画出从运输到使用的四步动作并做纸模。",
      "output": "动作顺序图与一处结构疑问",
      "check": "原作没给尺寸的地方标为未知，不补成作者事实。",
      "reflection": "你更想改结构还是减少功能？"
    },
    "remaining": [
      "所读评分来自黑龙江赛区，不能证明沈阳作品的原始获奖评分；完整安全和制造数据未公开",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "2024公开完整展板：Empty户外多功能灶具设计",
      "workedExample": {
        "title": "2024公开完整展板：Empty户外多功能灶具设计",
        "origin": "published_work",
        "sourceIds": [
          "b-industrial-rule",
          "b-industrial-work"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 已读Empty完整公开展板。黑龙江同届五项标准只作跨赛区参考评读；没有取得原作实际获奖评分、制造尺寸或安全测试，故不评定原作工程实测性能，不将该作品归入黑龙江参赛名单。",
        "steps": [
          "读取原展板的设计说明、结构细节、形态转换和画像，注明作者及转载来源。",
          "用纸模重建滑移与翻折，观察支撑、重心和操作空间；不给未知尺寸伪精度。",
          "将家庭多人和个人便携两类需求对照，找重量、容量和多功能冲突。",
          "按同届黑龙江五维标准写独立评读，明示未进行热源、安全及实物性能验证。"
        ],
        "reviewQuestions": [
          "冰箱滑出后支撑点是否足够？",
          "桌面与热源距离有没有实测依据？",
          "整合功能比独立器具组合多了什么成本？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "实用性：黑龙江训练尺度",
          "evidence": "动作、结构干涉与维护问题",
          "official": true,
          "factIds": [
            "national-college-industrial-design:v2:rubric"
          ]
        },
        {
          "criterion": "创造与表现：黑龙江训练尺度",
          "evidence": "功能组合的解释与图版可读性",
          "official": true,
          "factIds": [
            "national-college-industrial-design:v2:rubric"
          ]
        },
        {
          "criterion": "经济与环保：黑龙江训练尺度",
          "evidence": "重量、维修、材料和替代方案",
          "official": true,
          "factIds": [
            "national-college-industrial-design:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "结构与动作",
          "steps": [
            "重建推箱、滑出冰箱、展桌与取灶的动作顺序",
            "哪个部件需要先展开，是否产生干涉或倾倒？"
          ],
          "contributionProof": "本人动作图、纸模与失败照片"
        },
        {
          "role": "用户与成本",
          "steps": [
            "比较家庭和个人露营需求，列材料运输维护约束",
            "多功能是否增加了使用者不愿承担的重量？"
          ],
          "contributionProof": "本人需求取舍表和成本/重量假设"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "拆解原作品展板中的结构与需求依据",
          "completionCheck": "区分画面表达与已证实数据"
        },
        {
          "week": 2,
          "action": "制作无热源纸模并检查部件运动空间",
          "completionCheck": "找出一处干涉或重心风险"
        },
        {
          "week": 3,
          "action": "比较需求与替代方案",
          "completionCheck": "列出可删减功能的理由"
        },
        {
          "week": 4,
          "action": "整理独立评读并链接纸模观察证据",
          "completionCheck": "个人模型、观察与修订可追溯"
        }
      ],
      "exitConditions": [
        "不得用纸模结论声称真实燃气安全",
        "未获得原图版权许可时只引用链接，不重发原作品为自有成果"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "ecommerce-innovation-creativity-entrepreneurship",
    "name": "全国大学生电子商务创新、创意及创业挑战赛",
    "organizer": "全国三创赛竞组委；南京师范大学中北学院转发",
    "aliases": [],
    "authorAgentId": "/root/research_b",
    "editionId": "2025-15-rural",
    "edition": "第十五届2025乡村振兴实战赛",
    "groupId": "university-3-5",
    "group": "在校本专科和研究生3—5人团队",
    "scopeId": "china-rural-practical",
    "scope": "2025乡村振兴实战赛；不套常规赛",
    "origin": "legacy_135",
    "trackId": "rural-commerce",
    "trackName": "全福品平台农产品营销实战",
    "taskFamily": "business-practice",
    "subjectDomains": [
      "management",
      "agriculture",
      "economics"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-ecommerce-plan",
        "url": "https://cxcyxy.zbnc.edu.cn/info/1024/1171.htm",
        "title": "第十五届乡村振兴实战赛实施方案全文",
        "publisher": "全国三创赛竞组委；南京师范大学中北学院转发",
        "scope": "2025乡村振兴实战赛",
        "locator": "实施流程、参赛要求、创业实战评价",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-ecommerce-full-guide",
        "url": "https://3chuang.oss-cn-hangzhou.aliyuncs.com/uploads/file/2024/10/23/a013307e0ca9d6e87fa972b550de2463.pdf",
        "title": "第十五届乡村振兴实战赛实施方案及完整附件指南",
        "publisher": "全国三创赛竞组委、乡村振兴实战赛专家组",
        "scope": "第十五届2025乡村振兴实战赛全国实施方案与完整指南",
        "locator": "PDF全14页；第8页平台账号与交付，第9—12页完整100分评分及6+4+4周数据要求",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": "2024-10-22",
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/gap-repair-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "经学校审核的在校本专科、研究生，专业不限；3—5人，校导师与企业导师各0—2人。",
        "source": 0
      },
      "track": {
        "text": "本实战赛围绕全福品平台农产品营销，需与合作方明确授权和协议并积累真实实战记录。",
        "source": 0
      },
      "participation": {
        "text": "2024年9月25日至12月31日报名，2025校、省、国赛逐级推进。须在抖音和快手各开至少1个实名账号并绑定全福品，校赛至少6周实战数据、省赛再增4周、国赛再增4周；不是当前开放报名。",
        "source": 1
      },
      "deliverables": {
        "text": "项目报告书、PPT、承诺与指导教师说明及平台实战数据；报告至少分析一个团队真实操作典型案例及全周期周数据图。小组赛演讲不超过8分钟、问答7分钟；终极赛演讲不超过8分钟。",
        "source": 1
      },
      "rubric": {
        "text": "总分100：创新15、创意15、创业45、演讲15、文案10。创业细分准备10、过程20、业绩15；有效订单及交易额须完成且超过退换货期，业绩结合相对数量和赛区排名，不等同利润。无平台实战数据、创业分为0不计成绩。",
        "source": 1
      },
      "investment": {
        "text": "校赛至少6周实战数据，晋级省赛和国赛分别再增至少4周；各级现场赛前15天截止数据统计。需实名账号、授权合作及持续经营；指南未提供个人报名、材料、物流和差旅总费用，不能推断为零。",
        "source": 1
      }
    },
    "task": "在授权和履约能力明确后，为一个真实农产品制定选品、营销、交易与复盘流程。",
    "roles": [
      {
        "name": "供应与运营",
        "task": "核对商品授权、库存、运输和售后责任",
        "skills": [
          "business",
          "communication"
        ],
        "evidence": "营销增长后谁负责缺货、退货和品质争议？",
        "output": "本人授权核对表、履约流程和问题记录"
      },
      {
        "name": "内容与数据",
        "task": "设计营销内容，记录曝光到有效成交的变化",
        "skills": [
          "writing",
          "data-analysis"
        ],
        "evidence": "订单是否真实有效，退款是否已剔除？",
        "output": "本人内容版本、真实后台记录和复盘"
      }
    ],
    "gain": "积累经营过程与数据判断，理解销售额、有效订单和利润不同；不能用自买刷单制造成果。",
    "entry": "先能整理一个产品信息表与成本表；交易前必须取得授权。",
    "completion": "难点是授权、供应、售后和持续运营同时成立；至少6周校赛记录及晋级新增记录不能压成四周，营收和有效订单也不能替代利润与退款核算。",
    "investment": "编辑建议四周每周4—6小时仅做授权、成本、内容与统计方案的前期练习，不代表正式完赛。官方校赛数据至少6周，晋级省赛及国赛分别再增4周；正式账号、样品、运费、工具和差旅费用须另核。",
    "fit": [
      "愿意沟通供应商和顾客",
      "喜欢用真实经营数据修正内容"
    ],
    "avoid": [
      "只想写商业计划书不参与实战",
      "依靠刷单或未授权商品完成业绩"
    ],
    "trial": {
      "action": "选一个能取得授权的农产品，先画从购买到售后的责任流程。",
      "output": "商品信息与成本、履约责任表",
      "check": "没有授权与退款安排时不开始对外销售。",
      "reflection": "你是否愿意处理一笔失败订单的原因？"
    },
    "remaining": [
      "完整14页同届指南已补读，当前平台操作和本校通道仍须按实际参赛时确认；历史规则不作当届可报承诺",
      "个人总费用未知，账号与供应授权未落实时仅做离线准备",
      "作者研究草稿，尚待两位独立审阅者核对来源与学习路线"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方2025实战任务：全福品农产品营销与有效交易",
      "workedExample": {
        "title": "官方2025实战任务：全福品农产品营销与有效交易",
        "origin": "official_task",
        "sourceIds": [
          "b-ecommerce-plan",
          "b-ecommerce-full-guide"
        ],
        "sourceBoundary": "实施方案与完整14页指南均已读。以下为同届任务解析；四周仅前期准备，不替代校赛至少6周及省、国赛各新增4周实战。没有平台真实记录的模拟账不计参赛业绩。",
        "steps": [
          "先核帮扶主体授权、产品与合作协议，规划抖音和快手各至少一个实名账号及全福品绑定；未获授权不对外销售，离线阶段只画责任流程。",
          "把产品、运费、工具、退款和售后记入单笔账，分别标实际来源与未知；以创新和创意15分构面说明需求、可行性及方案差异，不用销售额冒充利润。",
          "规划校赛至少6周、省赛再4周、国赛再4周的记录节奏，各级现场赛前15天截止数据。把内容、互动、直播、订单等记录按周留证，拒绝刷单和把模拟数据当实战。",
          "按准备10、过程20、业绩15核查账号、持续性和有效订单定义，再用创新15、创意15、演讲15、文案10映射一份至少包含一个真实操作案例的报告；没有实际经营时只提交编辑练习稿，不声称完成赛事。"
        ],
        "reviewQuestions": [
          "是否把退货订单当有效业绩？",
          "流量增加能否覆盖履约成本？",
          "报告中的操作确实由团队完成吗？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "创业准备10分",
          "evidence": "授权、产品、供应及执行安排",
          "official": true,
          "factIds": [
            "ecommerce-innovation-creativity-entrepreneurship:v2:rubric"
          ]
        },
        {
          "criterion": "创业过程20分",
          "evidence": "持续运营与迭代记录",
          "official": true,
          "factIds": [
            "ecommerce-innovation-creativity-entrepreneurship:v2:rubric"
          ]
        },
        {
          "criterion": "创业业绩15分",
          "evidence": "可核验有效订单及平台统计口径",
          "official": true,
          "factIds": [
            "ecommerce-innovation-creativity-entrepreneurship:v2:rubric"
          ]
        },
        {
          "criterion": "创新15分与创意15分",
          "evidence": "标出产品或模式的具体不同及商业策划可行性，并附需求与成本证据",
          "official": true,
          "factIds": [
            "ecommerce-innovation-creativity-entrepreneurship:v2:rubric"
          ]
        },
        {
          "criterion": "演讲15分与文案10分",
          "evidence": "用至少一个本人参与的真实典型案例说明问题、操作、成效与复盘，练习稿明确尚无实绩",
          "official": true,
          "factIds": [
            "ecommerce-innovation-creativity-entrepreneurship:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "供应与运营",
          "steps": [
            "核对商品授权、库存、运输和售后责任",
            "营销增长后谁负责缺货、退货和品质争议？"
          ],
          "contributionProof": "本人授权核对表、履约流程和问题记录"
        },
        {
          "role": "内容与数据",
          "steps": [
            "设计营销内容，记录曝光到有效成交的变化",
            "订单是否真实有效，退款是否已剔除？"
          ],
          "contributionProof": "本人内容版本、真实后台记录和复盘"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "仅做前期准备：梳理一个农产品的授权、供应和售后责任",
          "completionCheck": "逐项标出有依据和未落实部分，未授权不交易"
        },
        {
          "week": 2,
          "action": "建立单笔成本练习表及两种内容方案，不注册或购买服务",
          "completionCheck": "样品、物流、退款和工具费用有来源或保留未知"
        },
        {
          "week": 3,
          "action": "按官方校赛6周要求设计周记录及账号关联核验清单",
          "completionCheck": "练习表不填虚构业绩，明确四周准备不能代替6周实战"
        },
        {
          "week": 4,
          "action": "对照100分五构面整理准备报告并判断是否具备继续实战条件",
          "completionCheck": "指出尚缺授权、预算、账号和团队资源，未落实则停在桌面方案"
        }
      ],
      "exitConditions": [
        "无法取得授权时只做运营设计，不能冒充实战完成",
        "真实需求不足就停小额试验，不以刷单补业绩"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "chongqing-rural-revitalization",
    "name": "重庆市大学生乡村振兴创意大赛",
    "organizer": "重庆市大学生乡村振兴创意大赛组委会",
    "aliases": [],
    "authorAgentId": "/root/research_b",
    "editionId": "2025-5",
    "edition": "第五届2025",
    "groupId": "students-graduates-2-5",
    "group": "在校及毕业五年内学生2—5人团队",
    "scopeId": "chongqing-regular",
    "scope": "重庆第五届常规赛；接受市内外高校，不等同全国赛",
    "origin": "verified_expansion",
    "trackId": "bencao-cultural-tourism",
    "trackName": "本草花创谷农文旅策划与推广",
    "taskFamily": "business-practice",
    "subjectDomains": [
      "agriculture",
      "management",
      "arts"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-rural-rules",
        "url": "https://www.cqgjxh.com/upload/file/202509/%E5%85%B3%E4%BA%8E%E4%B8%BE%E5%8A%9E%E7%AC%AC%E4%BA%94%E5%B1%8A%E9%87%8D%E5%BA%86%E5%B8%82%E5%A4%A7%E5%AD%A6%E7%94%9F%E4%B9%A1%E6%9D%91%E6%8C%AF%E5%85%B4%E5%88%9B%E6%84%8F%E5%A4%A7%E8%B5%9B%E7%9A%84%E9%80%9A%E7%9F%A5.pdf",
        "title": "第五届重庆乡村振兴创意大赛通知及评分附件",
        "publisher": "重庆市大学生乡村振兴创意大赛组委会",
        "scope": "2025重庆常规赛",
        "locator": "资格、作品要求、附件1常规赛初复赛评价表",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-rural-task",
        "url": "https://xtw.swupl.edu.cn/docs/2025-09/d9f9b43ef5ca415588bc637e066aae32.pdf",
        "title": "第五届大赛赛题指南：本草花创谷",
        "publisher": "重庆乡村振兴大赛组委会；西南政法大学公开附件",
        "scope": "2025北碚本草花创谷命题",
        "locator": "常规赛完整题目与324亩基地背景",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "市内外高校在校或2020年6月后毕业学生，2—5人、1—2导师，鼓励跨校；团队负责人限负责一件作品。",
        "source": 0
      },
      "track": {
        "text": "常规题为北碚本草花创谷农文旅策划及宣传；不得把电商专项评分混入。",
        "source": 1
      },
      "participation": {
        "text": "2025年10月31日中午12时提交初稿；学校初选、市复赛及现场决赛，现为历史资料。",
        "source": 0
      },
      "deliverables": {
        "text": "按常规赛提交完整项目设计文本与相关材料，含摘要，后续按通知进行现场陈述答辩。",
        "source": 0
      },
      "rubric": {
        "text": "常规赛初赛/复赛：可行落地、应用及影响60分，创意创新30分，资料完整10分；无摘要完整项0分。",
        "source": 0
      }
    },
    "task": "针对本草花创谷的真实场地与菊花产业资源，提出有明确客源、运营责任和落地成本的农文旅项目。",
    "roles": [
      {
        "name": "场地与需求",
        "task": "核实坡地、交通、季节及游客需求，区分题设和当前现场事实",
        "skills": [
          "research",
          "planning"
        ],
        "evidence": "哪些资源已经存在，哪些只是规划愿景？",
        "output": "本人场地证据表、访谈笔记和限制图"
      },
      {
        "name": "项目与运营",
        "task": "设计一项体验及推广路径，估算人力、成本和淡旺季风险",
        "skills": [
          "business",
          "design"
        ],
        "evidence": "活动结束后谁继续运营，农户如何受益？",
        "output": "本人服务流程、预算与利益分配假设"
      }
    ],
    "gain": "练习地方产业与体验策划，理解文化资源、运营和居民收益之间的关系；不能凭策划书声称完成乡村振兴。",
    "entry": "先会整理场地资料并提具体问题；无法实地时明确桌面研究边界。",
    "completion": "难点在尊重当地实际和长期维护，而非复制城市网红项目。",
    "investment": "编辑建议四周每周4—6小时做小方案；现场调研、交通、制作可能收费，报名费用未核明。",
    "fit": [
      "愿意听地方参与者的约束",
      "喜欢把创意连到持续运营"
    ],
    "avoid": [
      "只想套通用景区规划模板",
      "没有证据就宣称提高收入和就业"
    ],
    "trial": {
      "action": "据官方324亩山岭坡地背景，列一条游客动线与五个必须向基地核实的问题。",
      "output": "动线草图、题设/待核事实表",
      "check": "不把官方发展目标写成已建成设施。",
      "reflection": "你更愿意研究游客还是与运营者核成本？"
    },
    "remaining": [
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "2025官方常规题：北碚本草花创谷农文旅策划与宣传",
      "workedExample": {
        "title": "2025官方常规题：北碚本草花创谷农文旅策划与宣传",
        "origin": "official_task",
        "sourceIds": [
          "b-rural-rules",
          "b-rural-task"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。",
        "steps": [
          "从完整题设提取菊花主题、坡地、资源和目标，区分基地事实与建设愿景。",
          "定位一个具体客群，取得或设计合规访谈，分析交通、季节与停留时间。",
          "只设计一项可实施体验，写活动流程、人力、预算、收益对象及日常维护。",
          "把推广内容与真实供给对应，用60/30/10尺度检查落地证据而不是堆效果图。"
        ],
        "reviewQuestions": [
          "淡季还有需求吗？",
          "居民或经营者是否愿意承担维护？",
          "创意如何体现本地资源而非任意村庄都适用？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "可行落地及影响60分",
          "evidence": "场地约束、预算、运营责任与受益路径",
          "official": true,
          "factIds": [
            "chongqing-rural-revitalization:v2:rubric"
          ]
        },
        {
          "criterion": "创意创新30分",
          "evidence": "菊花与地方资源驱动的区别",
          "official": true,
          "factIds": [
            "chongqing-rural-revitalization:v2:rubric"
          ]
        },
        {
          "criterion": "资料完整10分",
          "evidence": "摘要、正文及支撑材料齐全",
          "official": true,
          "factIds": [
            "chongqing-rural-revitalization:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "场地与需求",
          "steps": [
            "核实坡地、交通、季节及游客需求，区分题设和当前现场事实",
            "哪些资源已经存在，哪些只是规划愿景？"
          ],
          "contributionProof": "本人场地证据表、访谈笔记和限制图"
        },
        {
          "role": "项目与运营",
          "steps": [
            "设计一项体验及推广路径，估算人力、成本和淡旺季风险",
            "活动结束后谁继续运营，农户如何受益？"
          ],
          "contributionProof": "本人服务流程、预算与利益分配假设"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "拆题并建立待核场地表",
          "completionCheck": "不混淆已建与计划"
        },
        {
          "week": 2,
          "action": "核客源和当地需求",
          "completionCheck": "保留不支持方案的意见"
        },
        {
          "week": 3,
          "action": "设计单项体验及预算",
          "completionCheck": "可解释人力与维护成本"
        },
        {
          "week": 4,
          "action": "形成推广与策划文本",
          "completionCheck": "个人调研和方案迭代可追溯"
        }
      ],
      "exitConditions": [
        "无法取得现场证据时仅标桌面方案，不声称落地",
        "本地合作方不认可核心需求时改题或停止扩张"
      ],
      "missingForPublication": []
    }
  },
  {
    "seriesId": "hult-prize",
    "name": "Hult Prize",
    "organizer": "Hult Prize Foundation",
    "aliases": [],
    "authorAgentId": "/root/continue_catalog",
    "editionId": "2023-fashion",
    "edition": "2023 Redesigning Fashion",
    "groupId": "campus-3-5",
    "group": "2023指南：同一大学校园3—5名学生",
    "scopeId": "global-2023-guide",
    "scope": "2023全球挑战指南；当年校园/公开申请路径",
    "origin": "legacy_135",
    "trackId": "sustainable-fashion",
    "trackName": "服装价值链可持续社会企业",
    "taskFamily": "business-practice",
    "subjectDomains": [
      "management",
      "economics",
      "arts"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-hult-guide",
        "url": "https://a.storyblok.com/f/133195/x/c87070884e/2023-hult-prize-challenge.pdf",
        "title": "2023 Hult Prize Challenge完整官方指南",
        "publisher": "Hult Prize Foundation",
        "scope": "2023全球服装可持续挑战",
        "locator": "第1、4页任务，第22页组队，第23页评审关注点",
        "authority": "organizer",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch03/reading-log.json"
      }
    ],
    "verified": {
      "eligibility": {
        "text": "2023官方指南要求校园内3—5名学生组队；后续届次团队人数不得倒套本届。",
        "source": 0
      },
      "track": {
        "text": "2023实际挑战Redesigning Fashion：在服装价值链创办创新社会企业，使服装更加可持续。",
        "source": 0
      },
      "participation": {
        "text": "2023通过OnCampus或General Application申请，之后Summits、加速器和决赛；历史路线不表示当前开放。",
        "source": 0
      },
      "deliverables": {
        "text": "指南要求形成商业方案与路演，包含最小可行产品、竞争差异、进入市场计划、财务预测和商业模式；具体上传限制待核。",
        "source": 0
      },
      "rubric": {
        "text": "官方2023指南第23页列评委期待：相关性、实用性、聚焦、盈利潜力、可衡量影响；未读取详细数字评分卡。",
        "source": 0
      }
    },
    "task": "在服装原料、生产、使用或回收的一处环节找问题，检验收入机制能否同时带来可衡量的社会或环境改善。",
    "roles": [
      {
        "name": "问题与影响",
        "task": "沿价值链定位受影响者、现有方案和可测基线",
        "skills": [
          "research",
          "critical-thinking"
        ],
        "evidence": "收入增加是否真的改善问题，还是只增加消费？",
        "output": "本人价值链图、访谈证据和影响口径"
      },
      {
        "name": "商业与试验",
        "task": "比较支付者、受益者、成本和小规模试验",
        "skills": [
          "business",
          "data-analysis"
        ],
        "evidence": "付钱的人与受益的人不同，谁愿意持续支付？",
        "output": "本人单位经济模型、原型反馈和反例"
      }
    ],
    "gain": "练习把社会影响和商业持续性放在同一证据链；不能用SDG图标或未经验证的减碳估计替代真实影响。",
    "entry": "先会访谈与简单成本拆分，服装专业不是唯一入口。",
    "completion": "难点是防止环保宣传超出证据，并处理规模扩大后的运输、材料和劳动条件。",
    "investment": "编辑建议四周每周4—6小时做需求与原型验证；官方指南未明确费用，不假定免费。",
    "fit": [
      "愿意检验商业模式和社会目标是否冲突",
      "愿意接触价值链中的真实参与者"
    ],
    "avoid": [
      "只写捐赠比例却不测问题变化",
      "愿意为路演夸大减排与就业数字"
    ],
    "trial": {
      "action": "沿一件衣服画原料到回收的路径，选一个障碍并列出支付者与受益者。",
      "output": "价值链图、基线指标和一个访谈提纲",
      "check": "不要引用指南企业宣传的环保数字作为本项目成效。",
      "reflection": "你愿意深入一个小问题而不是解决整个时尚行业吗？"
    },
    "remaining": [
      "2023详细数字评分卡与上传格式未读取，现仅以完整官方挑战指南的评审关注点作训练",
      "本条为作者研究草稿，尚待两名独立审阅者核对来源及学习路线。"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方2023任务：Redesigning Fashion服装价值链社会企业",
      "workedExample": {
        "title": "官方2023任务：Redesigning Fashion服装价值链社会企业",
        "origin": "official_task",
        "sourceIds": [
          "b-hult-guide"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 2023完整官方挑战指南第23页已给出五项定性评委关注点，本练习据此逐项核证；未取得另行数字评分卡和上传格式，不分配分值、不推定正式提交条件。",
        "steps": [
          "依据完整挑战指南选定一处价值链环节，说明现有参与者为何无法解决该问题。",
          "访谈目标使用者并画原型，允许反馈否定初始方案；保留本人记录。",
          "同时建立收入、成本和影响口径，列出运输或使用反弹可能抵消收益的条件。",
          "用五项官方关注点检验路演，区分已验证效果、计划和未知，避免绿色宣传夸大。"
        ],
        "reviewQuestions": [
          "影响指标是在数活动次数还是问题改善？",
          "业务收入增长是否会反而增加资源消耗？",
          "替代方案比你的方案更便宜吗？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "相关与聚焦",
          "evidence": "服装价值链具体问题及目标受众",
          "official": true,
          "factIds": [
            "hult-prize:v2:rubric"
          ]
        },
        {
          "criterion": "实用性",
          "evidence": "原型反馈与供应执行条件",
          "official": true,
          "factIds": [
            "hult-prize:v2:rubric"
          ]
        },
        {
          "criterion": "盈利潜力",
          "evidence": "支付意愿、单位经济和持续运营假设",
          "official": true,
          "factIds": [
            "hult-prize:v2:rubric"
          ]
        },
        {
          "criterion": "可衡量影响",
          "evidence": "基线、指标和不确定性范围",
          "official": true,
          "factIds": [
            "hult-prize:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "问题与影响",
          "steps": [
            "沿价值链定位受影响者、现有方案和可测基线",
            "收入增加是否真的改善问题，还是只增加消费？"
          ],
          "contributionProof": "本人价值链图、访谈证据和影响口径"
        },
        {
          "role": "商业与试验",
          "steps": [
            "比较支付者、受益者、成本和小规模试验",
            "付钱的人与受益的人不同，谁愿意持续支付？"
          ],
          "contributionProof": "本人单位经济模型、原型反馈和反例"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "定位价值链中的支付者与受益者问题",
          "completionCheck": "明确支付者、受益者和基线"
        },
        {
          "week": 2,
          "action": "开展访谈及低成本原型",
          "completionCheck": "至少记录一条否定性反馈"
        },
        {
          "week": 3,
          "action": "连接商业与影响模型",
          "completionCheck": "不把预测冒充成效"
        },
        {
          "week": 4,
          "action": "练习路演并整理证据",
          "completionCheck": "各成员的研究或模型贡献可定位"
        }
      ],
      "exitConditions": [
        "没有真实需求证据时不扩大投入",
        "无法解释影响计算口径时撤回量化宣传"
      ],
      "missingForPublication": [
        "2023开放可持续时尚挑战及五项定性评审已有原件，但仍缺完整具体项目/公开作品的可审拆解；通用商业策划流程不算完整案例。"
      ]
    }
  },
  {
    "seriesId": "chinese-classics",
    "name": "中华经典诵写讲大赛",
    "organizer": "湖州师范学院校赛组织单位",
    "aliases": [],
    "authorAgentId": "/root",
    "editionId": "2025-zhejiang-13",
    "edition": "2025浙江第十三届典润之江及湖州师范校选",
    "groupId": "huzhou-individual",
    "group": "湖州师范学院全日制在校个人，2025毕业生不在选送范围",
    "scopeId": "zhejiang-huzhou-local",
    "scope": "仅浙江省赛与湖州师范校选；个人组不等于全国通道",
    "origin": "legacy_135",
    "trackId": "classics-recitation",
    "trackName": "典润之江个人经典朗诵",
    "taskFamily": "language-communication",
    "subjectDomains": [
      "literature",
      "education",
      "history"
    ],
    "factStatus": "historical",
    "registrationStatus": "historical",
    "registrationNote": "历史届次，仅用于历史任务学习；不表示当前仍可报名，也不自动适用于下一届。",
    "sources": [
      {
        "id": "b-classics-local",
        "url": "https://rwxy.huznu.edu.cn/2025/0409/c534a231481/page.htm",
        "title": "湖州师范学院2025中华经典诵写讲校选通知",
        "publisher": "湖州师范学院校赛组织单位",
        "scope": "2025湖州师范典润之江校选",
        "locator": "赛项一参赛要求、竞赛内容；附件列表",
        "authority": "university_local",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-classics-rules",
        "url": "https://rwxy.huznu.edu.cn/_upload/article/files/24/5e/408522fc4fada966b2b571aa9c8f/b0053435-8be0-4bf1-a93c-e74ae08d4843.pdf",
        "title": "浙江第十三届大赛正式通知及四赛项方案",
        "publisher": "浙江省中华经典诵写讲大赛组委会",
        "scope": "2025浙江省赛分组及规则",
        "locator": "附件1第4—10页",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      },
      {
        "id": "b-classics-task",
        "url": "https://rwxy.huznu.edu.cn/_upload/article/files/24/5e/408522fc4fada966b2b571aa9c8f/90c168b5-4687-4f3c-bfb9-611ca1f56f66.pdf",
        "title": "2025典润之江初赛完整朗读题库",
        "publisher": "浙江省中华经典诵写讲大赛组委会",
        "scope": "2025浙江典润之江初赛",
        "locator": "古代部分第3题，第1页",
        "authority": "official_host",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json"
      }
    ],
    "verified": {
      "task": {
        "text": "2025官方朗读题库古代第3题《庄子·秋水》节选先写河伯“欣然自喜”，到北海后写“不见水端”，随后以“望洋向若而叹曰”引出河伯的话，其话内又有“野语有之曰”的引语；该段题面直接为“夫（fú）”和“少（shǎo）”注音。",
        "source": 2
      },
      "eligibility": {
        "text": "湖州师范校选面向本校全日制在校生，2025毕业生不在选送范围；历届该省赛同类别一二等奖选手受限制。",
        "source": 0
      },
      "track": {
        "text": "校选从2025指定题库选择一篇；读例为古代第3题《庄子·秋水》节选。",
        "source": [
          0,
          2
        ]
      },
      "participation": {
        "text": "由校选推荐浙江省赛；个人组省赛路线与全国综合组推荐不同，不能宣称个人校选直接通国赛。",
        "source": 1
      },
      "deliverables": {
        "text": "湖州校选为脱稿朗诵一篇，无需配乐、无需PPT；省初赛则另有古今各一篇朗读讲解和备稿演讲视频。",
        "source": [
          0,
          1
        ]
      },
      "rubric": {
        "text": "校选明确考阅读理解、艺术鉴赏、语言表达，要求普通话准确清晰与体态得当；未公布数字权重。",
        "source": 0
      },
      "investment": {
        "text": "浙江个人初赛每人500元由学校承担，禁止转向学生收费；决赛差旅住宿由学校承担，个人其他支出仍须确认。",
        "source": 1
      }
    },
    "task": "把指定古文中的认识转折转成有文本依据的停连、重音和语气，让听众听懂而非只感到情绪强烈。",
    "roles": [
      {
        "name": "文本解读",
        "task": "辨认河伯前后认知变化与引语层次，核对易错读音",
        "skills": [
          "research",
          "writing"
        ],
        "evidence": "为什么看到北海会改变叙述的节奏和语气？",
        "output": "本人句读、词义依据及表达注释"
      },
      {
        "name": "朗诵表达",
        "task": "录制两种处理，听众复述后调整重音与停顿",
        "skills": [
          "communication",
          "performance"
        ],
        "evidence": "听众是否听懂了转折，而不只是觉得你声音好听？",
        "output": "本人原始录音、反馈与逐句修订"
      }
    ],
    "gain": "积累文本细读、普通话与公开表达；朗诵方案属于个人解释，需要原句支撑。",
    "entry": "愿意逐句查词和听自己的录音即可开始，不要求播音专业。",
    "completion": "难点在文意、读音和情感不互相遮盖，尤其引用层次与虚词不能靠喊读解决。",
    "investment": "编辑建议四周每周3—4小时；省赛个人费用由学校承担的条款只适用该届该省，不扩大为所有赛事免费。",
    "fit": [
      "愿意反复细读和听录音",
      "喜欢解释语言如何承载思想变化"
    ],
    "avoid": [
      "只模仿名家音色不理解文本",
      "认为背景音乐能替代语言表达"
    ],
    "trial": {
      "action": "朗读题库《秋水》节选，给河伯看见北海前后各标一句核心转折。",
      "output": "句读稿与一分钟原声录音",
      "check": "读音和句意先核准，再讨论情绪；不改变指定原文。",
      "reflection": "别人能复述主人公认识如何变化吗？"
    },
    "remaining": [
      "校通知有届次与报名年份笔误，赛程以组委会确认为准；本条不据笔误判可报名。数字评分细则未公开读取"
    ],
    "deepCase": {
      "status": "draft",
      "representativeTask": "官方2025初赛题库第3题：《庄子·秋水》节选",
      "workedExample": {
        "title": "官方2025初赛题库第3题：《庄子·秋水》节选",
        "origin": "official_task",
        "sourceIds": [
          "b-classics-local",
          "b-classics-rules",
          "b-classics-task"
        ],
        "sourceBoundary": "具体任务或公开原作见所列原始来源；以下步骤、证据检查与四周练习是编辑分析，不是官方标准答案或获奖保证。 已披露的使用限制：校通知有届次与报名年份笔误，赛程以组委会确认为准；本条不据笔误判可报名。数字评分细则未公开读取。该限制仍须在正式参加前核对；历史学习案例不确认当届资格或个人总费用。",
        "steps": [
          "按官方题库固定文本核词义、引语和易错音，区分叙述者与河伯自述。",
          "标出从自喜、见海到反思的依据，把转折安排到停连和重音而非任意煽情。",
          "录两种节奏请听众无提示复述文意，找听不明白的位置并修订。",
          "完成脱稿表达；如练省赛再加同篇讲解，并明确尚缺现代篇目与备稿演讲。"
        ],
        "reviewQuestions": [
          "停顿是否把句法关系切断？",
          "河伯的反思有哪句原文支持？",
          "朗诵处理是否遮蔽引语层次？"
        ]
      },
      "rubricMapping": [
        {
          "criterion": "阅读理解",
          "evidence": "词义、句法及认识转折说明",
          "official": true,
          "factIds": [
            "chinese-classics:v2:rubric"
          ]
        },
        {
          "criterion": "艺术鉴赏",
          "evidence": "语气和节奏选择有原文依据",
          "official": true,
          "factIds": [
            "chinese-classics:v2:rubric"
          ]
        },
        {
          "criterion": "语言表达",
          "evidence": "读音准确、停连清楚和听众理解",
          "official": true,
          "factIds": [
            "chinese-classics:v2:rubric"
          ]
        }
      ],
      "rolePaths": [
        {
          "role": "文本解读",
          "steps": [
            "辨认河伯前后认知变化与引语层次，核对易错读音",
            "为什么看到北海会改变叙述的节奏和语气？"
          ],
          "contributionProof": "本人句读、词义依据及表达注释"
        },
        {
          "role": "朗诵表达",
          "steps": [
            "录制两种处理，听众复述后调整重音与停顿",
            "听众是否听懂了转折，而不只是觉得你声音好听？"
          ],
          "contributionProof": "本人原始录音、反馈与逐句修订"
        }
      ],
      "fourWeekPlan": [
        {
          "week": 1,
          "action": "核对选定文本的词义、句读和引语层次",
          "completionCheck": "易错音和引语层次标清"
        },
        {
          "week": 2,
          "action": "写出两种重音与节奏不同的表达方案",
          "completionCheck": "每个重音都有解释"
        },
        {
          "week": 3,
          "action": "录音并做听众复述",
          "completionCheck": "留下误解与修订记录"
        },
        {
          "week": 4,
          "action": "完成脱稿朗诵和短讲解",
          "completionCheck": "个人注释及声音版本完整"
        }
      ],
      "exitConditions": [
        "未核准词义读音时先停止情绪加工",
        "省赛正式参赛不能只交本篇，须补全其他规定材料"
      ],
      "missingForPublication": []
    }
  }
];
