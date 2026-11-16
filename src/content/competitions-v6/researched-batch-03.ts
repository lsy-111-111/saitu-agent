import { readSource, authoredDeepCase, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-03-reading-log.json" });
export const researchBatch03: ResearchedContent[] = [
  {
    seriesId: "international-mathematics-competition", name: "International Mathematics Competition for University Students", organizer: "International Mathematics Competition for University Students", aliases: ["IMC大学生数学竞赛"], editionId: "2026-33", edition: "2026第33届（历史题目）", groupId: "individual", group: "大学一至四年级个人参赛范围", scopeId: "bulgaria-2026", scope: "2026保加利亚现场IMC，不含独立的IMC Huawei Challenge", trackId: "proofs", trackName: "个人数学证明", taskFamily: "data-modeling", subjectDomains: ["science"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026届在7月27日至8月3日举行；2027安排须单独核验。",
    sources: [source("imc-2026-info", "https://imc-math.org.uk/?item=info&year=2026", "33rd IMC 2026 information", "IMC", "2026届参赛对象、场地、评阅与形式", "Overview正文36—45行"), source("imc-2026-day1", "https://imc-math.org.uk/archive/problems/2026/IMC_2026_Day_1_Problems.pdf", "IMC2026 Problems on Day 1", "IMC", "2026第一天正式公开试题", "PDF第1页第1题及文末数学公式"), source("imc-2026-day1-marking", "https://imc-math.org.uk/archive/problems/2026/IMC_2026_Day_1_Marking_Schemes.pdf", "IMC 2026 Day 1 Marking Schemes", "IMC", "2026第一天逐题评分方案，本记录解析第1题", "PDF第1页Problem 1三种解法及分步给分")],
    verified: {
      eligibility: { text: "2026面向完成大学第一至第四学年的学生，通常参赛时不超过23岁、例外由组织方决定；允许个人或不代表学校的学生团队参加。", source: 0 },
      track: { text: "正式比赛按个人数学解答评阅，涉及代数、分析、几何和组合；大学分队不把个人答案变成团队共同作答。", source: 0 },
      participation: { text: "2026为保加利亚现场住宿式比赛，参赛学生须住主办方提供的宿舍；可由学校领队或自行组织参加，不能视作全球线上赛。", source: 0 },
      deliverables: { text: "按官方数学试题完成可论证的解答；例如第一天第1题要求证明复合三角函数方程不存在实数解。题目以英文提供。", source: 1 },
      rubric: { text: "第1题官方方案分步考察等式变换、三角等式分支及周期、排除周期参数、上界和最终矛盾；漏掉周期或只处理一个分支会影响对应得分。", source: 2 }
    },
    eligibilityRules: [{ id: "imc-year-min", field: "year", operator: "min", value: 1, factIds: ["international-mathematics-competition:v2:eligibility"], note: "按2026已完成学年解释，特殊情形由组委会确认。" }, { id: "imc-year-max", field: "year", operator: "max", value: 4, factIds: ["international-mathematics-competition:v2:eligibility"], note: "2026规划参赛学年范围。" }, { id: "imc-age-exception", field: "age", operator: "requires_confirmation", value: "通常不超过23岁；例外须组织方批准", factIds: ["international-mathematics-competition:v2:eligibility"], note: "不能把有例外条款直接转成无例外拒绝。" }],
    task: "把一个看似能数值试算的问题转成完整证明，处理所有分支并让他人逐步检查推理。",
    roles: [{ name: "独立证明者", task: "选择合适恒等式或不等式，写出覆盖所有情形的逻辑链", skills: ["research", "writing"], evidence: "你能指出证明的关键一步，并解释漏掉一个边界或周期参数为什么不成立吗？", output: "本人证明草稿、错误修订与分步论证" }],
    gain: "练习可以留下严谨推理和纠错证据；解出历史题不代表已具备现场全部题目的能力，数学竞赛成绩也不等同应用建模作品。",
    entry: "先会基本三角恒等式和不等式证明；数值画图可用来形成猜想，但不能替代证明。", completion: "难点是选择路径、补齐边界与写成可评阅的英文数学表达；正式赴境外还需落实住宿与行程。",
    investment: "编辑建议每周4—6小时练一题及复盘；正式费用、签证、差旅和住宿总额在本次材料中未核实，低预算用户先用公开题学习。",
    fit: ["愿意反复检查证明漏洞", "想检验理论数学推理与表达"], avoid: ["只希望调用数值工具得到答案", "当前仅能远程且无法落实现场行程"],
    trial: { action: "读2026第一天第1题，先自行推理30分钟，再对照官方分步方案标出自己遗漏的分支。", output: "一份独立尝试及逐步纠错表", check: "不看答案能解释周期参数为何不能随意省略，并复述所用上界。", reflection: "你喜欢发现逻辑缺口，还是更喜欢用数据和程序验证现实问题？" },
    remaining: ["2027年龄及现场费用不沿用2026", "数值试验不能作为正式证明替代，专业名称也不能证明个人已具备相应基础"],
    deepCase: authoredDeepCase({ seriesId: "international-mathematics-competition", task: "2026第一天第1题：证明cos(cos x)=sin(sin x)无实数解。", title: "真实题目解析：从周期分支到上界矛盾", sourceIds: ["imc-2026-day1", "imc-2026-day1-marking"], boundary: "已读题目与第1题完整评分页；只概括一个官方证明路线，下面练习检查为编辑安排，不声称是学生已完成作品。", steps: ["先把余弦改写为正弦的互余表达，使原式成为两个正弦值相等。", "写全正弦相等的两类角度关系，并保留2π的整数周期项；这一步不能只写主值。", "利用sin x与cos x的取值限制排除不可能的周期参数，得到绝对值等于π/2的必要条件。", "用|sin x±cos x|不超过√2，与π/2较大产生矛盾；回查两分支是否都覆盖。"], questions: ["周期参数漏掉后哪一步不再有依据？", "为什么一个反例检验不足以证明所有实数都无解？", "上界中的等号条件与最后矛盾是否混淆？"], rubrics: [["三角变换与完整分支", "编辑检查：等式转换有依据，两个分支及整数周期都写出。"], ["上界与矛盾结论", "编辑检查：上界成立范围、周期排除及最终无解链条完整。"]], roles: [{ role: "独立证明者", steps: ["画出逻辑依赖", "写全分支与边界", "让同伴逐行找漏洞"], contributionProof: "原始尝试、修订标注和口头解释" }], weeks: [["复习互余恒等式和正弦等式分支", "能自己推导两类角度关系"], ["独立尝试第1题并标出卡点", "保留原始推理而非抄写答案"], ["对照评分页补周期及不等式论证", "每次修订对应一个明确漏洞"], ["用另一种表达复述证明并让人质疑", "不看原解可完整解释两分支"]], exits: ["无法解释基础恒等式时先回到基础证明练习", "暂时无出境条件时只做公开题路线，不承诺现场报名可行"] })
  },
  {
    seriesId: "dandad-new-blood", authorAgentId: "/root/continue_catalog", name: "D&AD New Blood Awards", organizer: "D&AD", aliases: ["D&AD新血奖"], editionId: "2027", edition: "2027（准备阶段）", groupId: "student", group: "2027年1月1日符合在读条件的学生", scopeId: "global-craft", scope: "2027学生身份与Craft类通用提交规则；具体品牌brief需另读", trackId: "craft", trackName: "Craft设计与文案命题", taskFamily: "visual-interaction", subjectDomains: ["arts", "literature"], origin: "verified_expansion", factStatus: "verified_current", registrationStatus: "upcoming", registrationNote: "2027入口计划于1月底开放；不是已可提交。公开资料的典礼日期存在差异，本记录不输出该日期。",
    sources: [source("newblood-2027-essential", "https://media.dandad.org/documents/NBA27-essential-info-271026.pdf", "New Blood Awards 2027 Essential Info", "D&AD", "2027学生及非学生资格分支、团队和Craft评审", "PDF第1页资格与团队；第2页Craft judging"), source("newblood-2027-submission", "https://media.dandad.org/documents/NBA27-preparing-your-entries-271026.pdf", "New Blood Awards 2027 Preparing your entries", "D&AD", "2027通用提交与匿名要求，不代替所选brief材料清单", "PDF第1页Title、Main vs optional、匿名；第2页文件规格"), source("newblood-2027-faq", "https://www.dandad.org/awards/new-blood-awards/faqs", "New Blood Awards FAQs", "D&AD", "2027当前FAQ与费用说明", "Eligibility、entry、teams、judging；70—173行")],
    verified: {
      eligibility: { text: "学生分支要求2027年1月1日就读认可的全日制或非全日制继续/高等教育课程，专业不限；酒精品牌另有当地法定饮酒年龄限制。", source: 0 },
      track: { text: "Craft包括交互、文案与平面等设计命题，须回应本届官方brief；不能拿既有任意作品替代命题回应。", source: 0 },
      participation: { text: "允许个人或最多5人团队，成员逐一注册且各自符合资格，可跨校；导师不是必需条件。", source: 0 },
      deliverables: { text: "提供作品标题、百词以内说明和所选brief要求的主交付；通常为视频、JPEG、交互或PDF。作品与文件名须匿名，说明用英文，主材料和选做材料分开。", source: 1 },
      rubric: { text: "Craft先看回应命题，再看执行完成度和细节，最后看创意及受众洞察；官方给出优先顺序，不等于公开数值权重。", source: 0 },
      investment: { text: "可每项作品支付15英镑，或由每位成员完成参赛调查获得全额报名费抵用券；制作工具与素材授权费用不包含在内。", source: 2 }
    },
    eligibilityFacts: [{"idSuffix": "team-size", "text": "可个人参赛或至多五人组队；超过五人不合格，每位成员均须满足参赛资格。", "sourceIds": ["newblood-2027-essential"]}],
    eligibilityRules: [{ id: "newblood-student-date", field: "enrolled", operator: "requires_confirmation", value: "2027-01-01认可继续/高等教育在读身份", factIds: ["dandad-new-blood:v2:eligibility"], note: "不能用今日在读自动证明未来指定日条件。" }, { id: "newblood-team", field: "teamSize", operator: "max", value: 5, factIds: ["dandad-new-blood:v2:eligibility.team-size"], note: "个人或最多五人，所有成员需分别符合资格。" }],
    task: "先准确理解品牌命题，再用设计或文案形成可感知的回应，说明受众洞察如何影响每项创意决定。",
    roles: [{ name: "命题理解与创意表达", task: "拆解受众、问题与限制，形成多版构思并测试是否被看懂", skills: ["design", "writing", "research"], evidence: "你为什么放弃另一版方案，受众反馈改变了哪一处？", output: "命题拆解、草图版本与测试记录" }],
    gain: "可形成有问题背景和迭代过程的设计作品；获奖与行业机会有选拔条件，作品版权和品牌资产许可应逐一检查。",
    entry: "先能解释一张设计为何面向某种受众；不要求先有商业作品，但要愿意修改而非只追求视觉炫技。", completion: "需要把理解命题、精细执行与清楚展示连接；一个漂亮原型不能代替主材料，也不能跳过brief细则。",
    investment: "编辑建议四周每周4—6小时完成一个构思测试；可先纸面草图，选购素材或工具前确认授权与实际需要。",
    fit: ["希望积累带过程的视觉或文案作品", "愿意让受众反馈改变设计"], avoid: ["只想提交与当届命题无关的旧作", "尚未读具体brief却认为通用格式足以合规"],
    trial: { action: "选一个公开brief摘要，列目标受众和待解决问题，画三种回应并请两人复述；在取得完整brief前仅作体验。", output: "三份草图、受众说明和待补规则清单", check: "能指出哪种表达回应了问题、哪里仍因缺完整brief而不确定。", reflection: "你更喜欢洞察、文案还是细节制作？" },
    remaining: ["本次具体品牌brief下载要求登录，未绕过登录，也未读取受保护文件；因此不计L3", "部分公开资料的典礼日期不一致；与入围无关的日期不作推算"]
  },
  {
    seriesId: "dandad-new-blood", name: "D&AD New Blood Awards", organizer: "D&AD", aliases: ["D&AD新血奖"], authorAgentId: "/root/continue_catalog",
    editionId: "2026-share-your-passion", edition: "2026 Share your passion历史命题", groupId: "eligible-creative", group: "2026指定日在读学生分支；非学生冲突分支不作资格确认", scopeId: "global-2026-dad-brief", scope: "2026 D&AD自我推广命题；不沿用2027Craft资格及优先次序", trackId: "personal-social-campaign", trackName: "个人创意社交传播", taskFamily: "visual-interaction", subjectDomains: ["arts", "literature"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "原题2026年3月17日17时GMT截止；仅作完整历史命题练习，不判断当届可报名。",
    sources: [
      { ...source("newblood-2026-dad-brief", "https://media.dandad.org/documents/NBA2026-D-AD-220126.pdf", "D&AD 2026 Share your passion完整命题", "D&AD", "2026该命题目标、受众、创作约束和交付", "完整2页，含身份披露例外和主/选交付"), evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch02/reading-log.json" },
      { ...source("newblood-2026-tutor-pack", "https://media.dandad.org/documents/New_Blood_Awards_2026_Tutor_Pack_UPDATED.pdf", "New Blood Awards 2026 Tutor Pack", "D&AD", "2026适用资格、通用材料规范和正式评审，非2027规则", "PDF第3页通用评审；26—27页交付；30—31页资格、团队及Judging Criteria；34—36页条款"), evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch02/reading-log.json" }
    ],
    verified: {
      eligibility: { text: "本记录只采用两处共同支持的学生分支：2026年1月1日就读认可的全日制或非全日制继续/高等教育课程；FAQ明确学生不限年龄和专业。个人或至多5人团队，每人均须合格，并受正式条款的赛事关联人员及家属等排除条件约束。同文件第30页FAQ的非学生门槛为over 18及自由职业折算6个月，第34页正式条款为2026年1月1日aged 18 and over及自由职业一年；未取得消歧依据，不选择任一版本确认非学生资格。", source: 1 },
      track: { text: "Share your passion要求为自己建立有持续性的社交传播活动，明确本人实践与热情、目标受众、求职/社群/品牌合作等目的，并解释平台与互动策略。", source: 0 },
      participation: { text: "按2026在线参赛规则提交原创命题回应；指南要求作品及解释使用英语，除非命题明确另有规定，本题未给中文提交例外。此题特别允许出现本人姓名、视频和照片，不能把该身份例外外推到其他匿名命题。", source: [0, 1] },
      deliverables: { text: "创作示例至少三条各不少于30秒的视频或五幅静态作品，可混合媒介；正式主材料为至多2分钟介绍视频或至多8张JPEG。选交交互作品；主交JPEG时可另交总长至多1分钟视频，主交视频时可另交至多4张JPEG。创作示例与评审介绍材料不是同一长度限制；正式作品和解释须符合英语提交要求，中文题面不等于允许中文参赛材料。", source: [0, 1] },
      investment: { text: "2026每项作品报名费15英镑，或由每位成员完成参赛调查获得全额报名费抵用券；这不足以确认个人总支出，设备、网络、制作及授权成本仍待核。", source: 1 },
      rubric: { text: "2026指南列出创意、执行与回应命题三个通用评审问题，并明确Games Design命题标准略有不同；广告大创意类与Craft类的优先次序也不同。本题未明确对应哪一优先分支，故不自定权重或冒用2027Craft排序。", source: 1 }
    },
    eligibilityRules: [{ id: "newblood-2026-status", field: "priorQualification", operator: "requires_confirmation", value: "2026-01-01认可课程在读学生，且不属于正式条款排除的赛事关联人员及家属等", factIds: ["dandad-new-blood:v2:eligibility"], note: "仅学生分支；非学生年龄/自由职业门槛冲突未消解，不以此确认非学生资格；历史记录不直接报名" }, { id: "newblood-2026-team", field: "teamSize", operator: "max", value: 5, factIds: ["dandad-new-blood:v2:eligibility"], note: "2026所有成员均须合格" }],
    task: "把自己的创意实践变成一个能够持续展开、面向明确受众的社交内容系列，并用可审查样稿说明传播策略。",
    roles: [{ name: "创意与视觉表达", task: "明确创作定位、安排至少五幅静态内容的连续叙事，并设计可讨论的问题", skills: ["design", "writing", "presentation"], evidence: "每一幅如何服务同一个受众目的，而非五幅互不相关的作品？", output: "系列样稿、平台选择理由和改版记录" }],
    gain: "可形成自我定位、连续内容设计与作品表达证据；没有发布或反馈时只称模拟提案，不虚报传播或录用结果。",
    entry: "从已有的一项真实创意实践出发，用纸面或已有设计工具做五幅静态样稿；不要求购买流量或公开个人隐私。",
    completion: "难点是连续内容的关系、受众需求与本人真实贡献匹配，以及区分创作作品数量和提交介绍格式。",
    investment: "编辑建议四周每周3—5小时，用已有设备做离线样稿；中文草稿只作练习，正式英语表达的准备时间另行评估。正式报名、版权素材与个人网络设备总成本未核，不承诺免费参赛。",
    fit: ["愿意解释自己的创意选择", "喜欢把多个内容组织成可持续系列"], avoid: ["想购买互动数据替代真实传播效果", "无法区分素材许可和本人原创贡献"],
    trial: { action: "选择一项本人做过的创意练习，写清受众与目的，画五幅静态样稿并解释每幅如何推动下一次交流。", output: "五幅样稿、受众说明、平台选择理由", check: "五幅有共同主线，不虚构受众反馈；作品来源和本人贡献可追溯。", reflection: "你更喜欢视觉制作、叙事编排还是理解受众？" },
    remaining: ["历史截止已过，正式新届资格及个人总成本另核", "本题以2026通用评审问题作自查参考；Games Design有例外，不推断本题未标明的分支排序", "未发布样稿时不声称传播成效，也不把本人姓名例外推广到其他命题"],
    deepCase: authoredDeepCase({
      seriesId: "dandad-new-blood", task: "2026官方完整命题Share your passion：面向明确受众设计推广自己的持续社交活动，并提交系列示例与策略解释。", title: "真实命题拆解：五幅静态样稿怎样形成连续交流", sourceIds: ["newblood-2026-dad-brief", "newblood-2026-tutor-pack"], boundary: "读取完整两页官方题及2026提交/评审指南；示范选择题目允许的五幅静态作品路径。以下是编辑学习路线，不是获奖案例、不声称实际发布或测得传播效果。",
      steps: ["写出本人已有实践、目标受众、受众问题和期望结果，检查叙述来自真实经历；不把品牌知名度或泛泛求职口号当受众洞察。", "建立一条连续创意主线并制作五幅静态样稿，分别承担引入、展示、解释、回应和邀请讨论等作用；这些角色是编辑建议，不是官方规定。", "根据所选平台说明内容形式、发布节奏和对话机制；若使用多个平台，说明受众与内容怎样变化，不能只改图片尺寸。", "整理至多8张JPEG主材料或至多2分钟介绍视频，核对五幅创作示例均可理解；中文练习稿须另转成符合要求的英语作品及解释，编辑建议参照2026通用评审问题自查创意、执行与命题回应，不推断分支权重，区分样稿和真实投放结果。"],
      questions: ["为什么这个受众会关心你的内容？", "五幅是连续活动还是作品拼盘？", "哪些反馈只是计划，哪些确有记录？"],
      rubrics: [["2026回应命题", "明确自己、受众、目标、系列创作及社交策略之间的对应关系"], ["2026创意", "说明本人视角与受众洞察为何支持这条系列主线"], ["2026执行", "样稿可读、平台适配、主交付格式正确；不自行追加数值权重"]],
      roles: [{ role: "个人创意作者", steps: ["界定真实定位", "设计系列叙事", "解释策略并修订"], contributionProof: "本人草稿、素材许可、版本差异与选择理由" }],
      weeks: [["读题并确定真实实践与受众", "能一句话解释活动的目标与对象"], ["完成五幅静态样稿初稿", "各幅分工清楚且有连续主线"], ["核对平台与交流机制", "区分实际反馈和未验证计划"], ["整理符合正式格式及英语要求的介绍材料", "数量、时长、语言和本人身份例外逐项可追溯"]],
      exits: ["没有真实实践素材时先积累个人练习，不编造经历", "素材权利不清时改用自己的原创稿", "无法验证传播效果时仅保留可审查提案"]
    })
  }
];
