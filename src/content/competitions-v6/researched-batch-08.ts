import { readSource, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-08-reading-log.json" });
export const researchBatch08: ResearchedContent[] = [
  {
    seriesId: "national-marine-knowledge", name: "全国海洋知识竞赛", organizer: "自然资源部、共青团中央、海军政治工作部", aliases: [], editionId: "2025-2026-15", edition: "第15届广东选拔（历史）", groupId: "full-time-college", group: "广东全日制本专科大学生", scopeId: "guangdong-semifinal", scope: "广东省大学生选拔半决赛；不套用于公众组、港澳邀请或全国决赛", trackId: "marine-knowledge", trackName: "海洋知识答题", taskFamily: "investigation", subjectDomains: ["science", "law", "history"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2025年11月14日承办方明确报名已结束；半决赛11月15日，省决赛12月6日，均为历史。",
    sources: [{ ...source("marine15-national", "https://www.hunan.gov.cn/zqt/zcsd/202506/t20250611_33706249.html", "关于开展第15届全国海洋知识竞赛活动的通知", "自然资源部等（湖南省政府转载）", "全国系列及大学生选拔安排", "自然资办函〔2025〕1316号正文", "2025-06-04"), authority: "official_host" }, { ...source("marine15-gd-eligibility", "https://www.hualixy.edu.cn/youth/txzx/ggtz/content_74013", "第15届海洋知识竞赛广东选拔通知", "广州华立学院团委转发广东赛事规程", "广东大学生组资格；本校10月27日截止不推广到全省", "正文第三部分竞赛规程大学生组选拔", "2025-09-23"), authority: "official_host" }, source("marine15-gd-semifinal", "https://www.gdhyxh.org/NewsView.asp?id=1580", "广东赛区大学生选拔赛相关事宜通知", "广东海洋协会", "广东2025半决赛及省决赛", "半决赛与决赛正文（直接HTTP读取）", "2025-11-14")],
    verified: {
      eligibility: { text: "广东大学生组选拔限广东省本专科院校全日制在校学生，港澳邀请和公众组另有范围。", source: 1 },
      track: { text: "从海洋知识学习和线上个人答题进入学校代表队选拔；不是海洋科研作品赛。", source: 2 },
      participation: { text: "学校集中组织、现场监考并接受组委会线上监督，学校领取考试账号；不能自行通过公众答题取得大学生决赛资格。", source: 2 },
      deliverables: { text: "指定时间完成线上试卷；各校按个人成绩降序每三人成一队计总分，不足三人的余数成绩无效。", source: 2 },
      rubric: { text: "半决赛按队伍三人成绩总和选前12队，每校最多三队晋级；省决赛一等奖三人获全国决赛推荐。具体题分和同分规则未读取。", source: 2 }
    },
    eligibilityRules: [{ id: "marine-region", field: "region", operator: "requires_confirmation", value: "学校位于广东省", factIds: ["national-marine-knowledge:v2:eligibility"], note: "不是户籍限制，需核学校所在地。" }, { id: "marine-degree", field: "degree", operator: "in", value: ["undergraduate", "vocational"], factIds: ["national-marine-knowledge:v2:eligibility"], note: "本专科，不含研究生。" }, { id: "marine-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["national-marine-knowledge:v2:eligibility"], note: "全日制在校。" }],
    task: "学习海洋现象、资源保护与相关常识，在限时答题中区分记忆、理解和信息来源可靠性。",
    roles: [{ name: "知识学习与核对", task: "整理概念并核对容易混淆的表述", skills: ["research", "writing"], evidence: "哪道错题源于概念混淆，原资料如何支持纠正？", output: "来源明确的概念卡和错题原因" }, { name: "组内讲解", task: "把一个海洋现象讲清楚并接受同伴追问", skills: ["presentation", "team-management"], evidence: "同伴追问暴露了哪条知识缺口？", output: "简短讲解与问题清单" }],
    gain: "能形成海洋素养、信息核查与限时学习习惯；答题名次不能替代实验或海洋专业资格。",
    entry: "可独立学习公开科普资料；正式省赛需要学校组织与学籍条件。", completion: "难点是覆盖面和易混概念，而不是复杂设备；未读本届题库，不能保证练习题与试卷一致。",
    investment: "编辑建议两周每周3小时先学习一个主题；个人报名及线下交通支出未查明，不承诺免费。",
    fit: ["对海洋与环境知识有兴趣", "愿意追查答案的出处"], avoid: ["只想购买题库押题", "学校不在该赛区却想直接报名此阶段"],
    trial: { action: "从官方海洋科普材料选潮汐、海流或生态保护一个主题，写五道自测题并为每题注明出处。", output: "五题、解析和错因清单", check: "解释错误选项为什么不成立，不能只报正确字母。", reflection: "你喜欢拓展知识还是更希望做实际实验？" },
    remaining: ["未取得本届完整试卷与评分细则，不计L3", "广东阶段不能代表其它省或全国现行报名资格"]
  },
  {
    seriesId: "national-student-network-culture", authorAgentId: "/root/continue_catalog", name: "全国大学生网络文化节", organizer: "教育部、中央网信办", aliases: [], editionId: "2025-8", edition: "2025第八届（历史）", groupId: "full-time-student", group: "高校全日制在校学生", scopeId: "china-student-writing", scope: "大学生组网语青年说；不与面向教师的网络教育优秀作品活动混用", trackId: "online-writing", trackName: "网语青年说", taskFamily: "language-communication", subjectDomains: ["literature", "arts", "history", "philosophy"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "第八届征集2025年10月15日截止；本记录只提供历史写作路径，不代表新届开放。",
    sources: [{ ...source("networkculture8-notice", "https://xsc.btbu.edu.cn/xxtz/938492522cec43ba88f0f69dd96c678b.htm", "组织参加第八届全国大学生网络文化节通知", "北京工商大学学生工作部转载全国通知", "全国活动学生身份、征集与写作要求", "三、四（四）、五", "2025-07-04"), authority: "official_host" }, source("networkculture8-plan", "https://dxs.moe.gov.cn/zx/a/sy_xzsd/250606/2009024.shtml", "第八届全国大学生网络文化节工作方案", "中国大学生在线", "网语青年说及作品提交规则", "一（四）、二、三", "2025-06-06"), source("networkculture8-faq", "https://dxs.moe.gov.cn/zx/a/hd_wlwhj_cjwt/250618/2009776.shtml", "第八届全国大学生网络文化节常见问题解答", "中国大学生在线", "提交、导师、费用与原创素材", "一、二、三、五、八、九", "2025-06-18")],
    verified: {
      eligibility: { text: "大学生网络文化节面向高校全日制在校学生；网语青年说为单人作品，可配一位指导教师。", source: 0 },
      track: { text: "网语青年说接受网络文章、文学和评论；同一作品不能跨赛道或重复通过自荐与单位推荐提交。", source: 1 },
      participation: { text: "学生可自荐，由初选进入复选；作品须先在公开新媒体平台发布，校内论坛不算，官网线上提交。", source: 2 },
      deliverables: { text: "文章不超过5000字，可配图；一位作者、可配一位教师。首次发表需在2024年1月15日至2025年10月15日范围，提交后作者及题名等不能修改。", source: 1 },
      investment: { text: "FAQ明确参赛全过程不收参赛费；这不等于设备、创作或自选活动的个人成本为零。导师非必填。", source: 2 }
    },
    eligibilityFacts: [{"idSuffix": "author-count", "text": "第八届网语青年说赛道每件作品作者限一人，可配一名指导教师；不套用于其他赛道。", "sourceIds": ["networkculture8-plan"]}],
    eligibilityRules: [{ id: "network-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["national-student-network-culture:v2:eligibility"], note: "高校在校。" }, { id: "network-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["national-student-network-culture:v2:eligibility"], note: "全日制。" }, { id: "network-single", field: "teamSize", operator: "eq", value: 1, factIds: ["national-student-network-culture:v2:eligibility.author-count"], note: "网语青年说单人，不套用于视频等其它赛道。" }],
    task: "围绕可以核实的校园或社会观察写一篇有立场、有依据、适合公开网络传播的文章。",
    roles: [{ name: "观察与写作", task: "选择具体问题、查证背景并组织论证", skills: ["writing", "research"], evidence: "文章中哪句话是事实，哪句话是你的判断，读者如何区分？", output: "文章草稿、事实出处和修改记录" }, { name: "读者测试", task: "独立作者邀请同伴指出不清楚之处，自己决定修改", skills: ["presentation", "visual-design"], evidence: "哪条反馈改变了结构，而非只是换词？", output: "读者反馈、版本差异和合法素材说明" }],
    gain: "可积累写作、查证与公开表达证据；传播量不是作品质量的唯一证明，更不能保证评选结果。",
    entry: "能描述一个具体观察即可从短文开始，不要求先有粉丝或指导教师；正式作品须符合当届发表区间。", completion: "难点是观点有证据、结构清楚和素材权利明确，不能把未经核实的故事写成事实。",
    investment: "编辑建议两周每周3小时完成短文与两轮修改；参赛费为零，创作投入按个人条件另算。",
    fit: ["喜欢写作并愿意接受读者反馈", "愿意核查引用和图片权限"], avoid: ["打算抄写热帖或购买作品", "不愿公开作品或无法确认素材使用权"],
    trial: { action: "写一篇约800字校园观察，标注事实来源与个人判断，请一名同伴圈出两处不清楚的论证后修订。", output: "初稿、反馈与修订稿", check: "每个关键事实可追溯，删去一条缺乏依据的断言并说明原因。", reflection: "你更享受找证据、搭结构还是语言表达？" },
    remaining: ["未读具体官方评分量表与完整获奖文章，不计L3；不得把传播量自行写成评分权重", "FAQ说明作者通常保留版权、主办方有展示宣传权；完整授权范围提交前应阅读当届原通知"]
  }
];
