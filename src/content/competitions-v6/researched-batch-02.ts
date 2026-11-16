import { readSource, authoredDeepCase, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-02-reading-log.json" });

export const researchBatch02: ResearchedContent[] = [
  {
    seriesId: "meteorological-science-innovation", name: "全国大学生气象科技创新大赛", organizer: "中国气象学会", aliases: [], editionId: "2026-2", edition: "2026第二届（历史创意构思类）", groupId: "undergraduate", group: "本科生组", scopeId: "china-concept", scope: "第二届本科生组创意构思类，采用已读项目申报要求", trackId: "concept", trackName: "创意构思类", taskFamily: "investigation", subjectDomains: ["science", "engineering", "agriculture"], origin: "verified_expansion", factStatus: "historical",
    registrationStatus: "historical", registrationNote: "官网已公布2026决赛结果，本记录用于历史任务准备；不能由‘4月开放’推算下一届报名日。",
    sources: [source("meteorology-2026-application", "https://ccsmic2026.cms1924.org/cn/web/index/32458_2808858", "第二届全国大学生气象科技创新大赛项目申报", "中国气象学会赛事官网", "2026本科及研究生组申报要求；本记录选本科创意构思", "参赛对象、作品形式、申报材料，正文6—44行"), source("meteorology-2026-home", "https://ccsmic2026.cms1924.org/", "第二届全国大学生气象科技创新大赛", "中国气象学会赛事官网", "2026届阶段与已发布结果索引", "第一至第三阶段及2026-11-02结果公告索引")],
    verified: {
      eligibility: { text: "全国高校在校本科生和研究生可按学段分组，年龄不超过30周岁；允许个人或团队，申请材料需高校盖章推荐。", source: 0 },
      track: { text: "分创意构思、技术开发、学术研究与创业实践；本记录为本科创意构思，不要求将其他类实物或论文当成通用材料。", source: 0 },
      participation: { text: "准备官方申报表、项目计划书、学校推荐与原创承诺，依官网流程提交；初评后入围现场展示交流。", source: 0 },
      deliverables: { text: "创意构思需千字以内说明科学原理、创新与应用价值，可辅助图或视频；计划书说明背景、方案、实施、分工及预算。", source: 0 }
    },
    eligibilityRules: [{ id: "meteorology-degree", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["meteorological-science-innovation:v2:eligibility"], note: "本条选本科组，研究生应另选本系列研究生记录。" }, { id: "meteorology-age", field: "age", operator: "max", value: 30, factIds: ["meteorological-science-innovation:v2:eligibility"], note: "依据申报页年龄上限。" }, { id: "meteorology-endorsement", field: "institution", operator: "requires_confirmation", value: "高校盖章推荐", factIds: ["meteorological-science-innovation:v2:eligibility"], note: "尚未落实学校推荐时保留条件未知。" }],
    task: "从天气风险或气象服务中的具体问题提出可解释的新方案，说明科学依据、如何验证和需要哪些资源。",
    roles: [{ name: "问题与证据研究", task: "把天气现象转成可验证的服务需求，核对数据来源与适用地区", skills: ["research", "data-analysis", "writing"], evidence: "哪个观测支持你的方案，什么天气条件会使它失效？", output: "问题定义、资料对照和验证计划" }],
    gain: "完成创意稿可证明检索、科学论证和方案表达；尚未实施时只能称方案设计，不能称已改善预报或避免灾害。",
    entry: "能读懂基本天气数据和图表可先尝试；没有专业基础时从资料比较开始，不直接发布安全预警。", completion: "难在说明创新相对于现有方法在哪里，以及用什么数据能反驳或支持方案。",
    investment: "编辑建议一周做一页构思，四周每周4小时补证据；设备、软件、调研与参赛费用未核实，不能按免成本承诺。",
    fit: ["喜欢解释天气与真实生活问题", "愿意用数据挑战自己的想法"], avoid: ["只想用气象名词包装无依据的产品", "希望未验证方案直接承担灾害预警"],
    trial: { action: "选一次身边天气影响，比较两份公开资料，提出一个可检验的小改进。", output: "一页问题、原理、方案与反例", check: "能列出验证所需数据及至少一个失败条件。", reflection: "你更愿意找现象、比较数据还是向用户解释信息？" },
    remaining: ["官网申报页给出创新性要求，但未采用完整评分表；评分维度与权重保持未知", "团队人数上限、具体文件上传限制与费用待完整规程核验"]
  },
  {
    seriesId: "real-estate-urban-renewal-planning", name: "全国大学生房地产与城市更新策划大赛", organizer: "中国建设教育协会", aliases: ["全国大学生房地产策划大赛"], editionId: "2026-18", edition: "2026第十八届", groupId: "undergraduate-final", group: "本科组已晋级总决赛队伍", scopeId: "china-urban-renewal-final", scope: "第十八届城市更新项目策划本科组总决赛；需已有校赛晋级资格", trackId: "urban-renewal", trackName: "城市更新项目策划", taskFamily: "business-practice", subjectDomains: ["engineering", "management"], origin: "verified_expansion", factStatus: "verified_current",
    registrationStatus: "closed", registrationNote: "初始报名7月30日截止、总决赛名单10月25日截止；11月赛事仅供已晋级队伍参加，不能新报决赛。",
    sources: [source("urban-renewal-2026-notice", "https://www.ccen.com.cn/info/1150/5980.htm", "第十八届房地产与城市更新策划大赛通知", "中国建设教育协会", "2026全国院校报名、赛项与晋级安排", "赛项设置、参赛对象、初赛与总决赛、其他事宜；92—155行", "2026-05-12"), source("urban-renewal-2026-final", "https://www.ccen.com.cn/info/1150/6130.htm", "第十八届房地产与城市更新策划大赛总决赛通知", "中国建设教育协会", "2026已晋级队伍的现场总决赛", "参会形式、总决赛作品提交、会务费；84—158行", "2026-09-28")],
    verified: {
      eligibility: { text: "最初面向全日制在校大学生，由院校组队和校赛选拔；本记录限定已晋级的本科队伍，不把决赛会期当开放报名。", source: 0 },
      track: { text: "城市更新项目策划是独立赛项，与好房子、社区运营及物业数智运维分开；完整赛题任务书需另取。", source: 0 },
      participation: { text: "院校按规定比例上推决赛；所有晋级队伍现场抽签展示答辩，2026决赛安排在北京建筑大学。", source: 1 },
      deliverables: { text: "总决赛必交PPT演示文件（建议转PDF），视频可选；报到现场交件后不得修改，材料与展示均不得泄露学校及成员身份。", source: 1 },
      investment: { text: "总决赛高校会务费为每队1500元，不含差旅、交通、住宿等；由谁承担须向所在学校核实。", source: 1 }
    },
    eligibilityRules: [{ id: "urban-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["real-estate-urban-renewal-planning:v2:eligibility"], note: "在校学生范围。" }, { id: "urban-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["real-estate-urban-renewal-planning:v2:eligibility"], note: "初始资格要求全日制。" }, { id: "urban-qualified", field: "priorQualification", operator: "requires_confirmation", value: "院校上推全国总决赛", factIds: ["real-estate-urban-renewal-planning:v2:eligibility"], note: "这是决赛记录，未晋级者仅可用作准备路线。" }],
    task: "围绕城市更新项目，把现状调研、使用者需求、运营约束与方案取舍组织成可答辩的策划。",
    roles: [{ name: "更新调研与可行性", task: "识别空间使用问题，比较利益相关者诉求和成本假设", skills: ["fieldwork", "research", "accounting-finance"], evidence: "你如何区分现场观察、访谈转述和未经证实的需求？", output: "现状记录、利益相关者图和方案比较" }, { name: "策划表达", task: "将方案与证据对应，准备对限制和替代方案的回答", skills: ["presentation", "writing", "design"], evidence: "哪一项设计因成本或居民反馈改变，为什么？", output: "演示稿、证据索引和答辩问题表" }],
    gain: "实际完成可留下调研与策划比较材料；没有实施不能写成已改善社区，作品展示还须遵守原项目资料使用条件。",
    entry: "可先观察一处公共空间并区分事实与假设；正式参赛先确认院校、学段和晋级状态。", completion: "难在需求、空间与运营条件同时成立，既能解释方案，也能承认尚未取得的数据和授权。",
    investment: "编辑建议四周每周4—6小时做一个小场地桌面方案；正式参赛可能涉及实地考察、指导、会务及赴京成本，低预算学生应先做学习作品。",
    fit: ["愿意结合空间观察和经营分析", "希望练习把方案取舍讲清楚"], avoid: ["只想画效果图不做需求核验", "未取得晋级资格却计划直接参加决赛"],
    trial: { action: "观察一处可合法进入的公共空间，记录三个使用问题，画两种小规模改善方案并比较维护成本。", output: "现状图、两案比较及待确认问题表", check: "每个设计决定都能连到观察证据或明确标注的假设。", reflection: "你更喜欢看现场、算运营，还是做图与答辩？" },
    remaining: ["完整项目任务书及专业评分维度未读到，不构造评分权重或L3案例", "‘房地产策划’历史别名连续性需补早期官方证据，目前仅作为检索别名"]
  },
  {
    seriesId: "national-software-testing", name: "全国大学生软件测试大赛", organizer: "全国大学生软件测试大赛组委会、CCF相关专业委员会", aliases: [], editionId: "2025-10", edition: "2025第十届（历史练习参考）", groupId: "individual", group: "个人赛本科及研究生、专科组别范围", scopeId: "china-web-2025", scope: "2025全国Web应用测试个人赛；不复用2026工具或晋级名额", trackId: "web-testing", trackName: "Web应用测试个人赛", taskFamily: "software-algorithms", subjectDomains: ["engineering"], origin: "verified_expansion", factStatus: "historical",
    registrationStatus: "historical", registrationNote: "2025历史届次；2026通知已另发现但不混入本记录评分和工具要求。",
    sources: [{ ...source("testing-2025-rules", "https://cie.hsu.edu.cn/_upload/article/files/4c/cd/ec4c409b42b8935c13cb0fef7ba8/e2b38fc7-deaf-46d0-9613-46b6146fbb73.pdf", "全国大学生软件测试大赛（2025）通知及竞赛规程", "全国大学生软件测试大赛组委会（黄山学院托管原件）", "2025全国规程原件，非校内改写通知", "PDF第1、3—6页资格、工具、晋级、报名", "2025-09-10"), authority: "official_host" }, { ...source("testing-2025-track", "https://cie.hsu.edu.cn/_upload/article/files/4c/cd/ec4c409b42b8935c13cb0fef7ba8/58ec3abc-b3c4-4e96-884b-68355b624244.pdf", "2025软件测试大赛赛项说明", "全国大学生软件测试大赛（黄山学院托管原件）", "2025Web应用测试个人任务与评分；不借用开发者/嵌入式权重", "PDF第1页Web应用测试的环境、交付与评分"), authority: "official_host" }],
    verified: {
      eligibility: { text: "2025个人赛接受全日制高校在校研究生、本科和专科学生；高职团队另设条件，不混用。教师信息需登记，规程另允许自行参赛填写‘无’。", source: 0 },
      track: { text: "Web应用测试与开发者测试、嵌入式测试分别设项；本记录针对给定网页及需求进行功能测试。", source: 1 },
      participation: { text: "本人在慕测报名，经历预选赛、省赛或网络赛及全国决赛；每阶段成绩不结转，具体晋级比例仅适用2025。", source: 0 },
      deliverables: { text: "提交功能测试用例、可运行测试脚本及关键节点截图；用例、代码和截图必须对应同一需求与操作过程。", source: 1 },
      rubric: { text: "Web赛项评估用例覆盖、可读规范与复现性，脚本一致性与稳定运行，以及截图对关键状态的呈现；同分按提交时间，不套用其他赛项权重。", source: 1 },
      investment: { text: "2025规程说明大赛不收费用；全国决赛差旅食宿另有安排，个人实际承担额须核实，不承诺总支出为零。", source: 0 }
    },
    eligibilityRules: [{ id: "testing-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["national-software-testing:v2:eligibility"], note: "针对2025历史个人赛。" }, { id: "testing-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["national-software-testing:v2:eligibility"], note: "原规程全日制高校范围。" }, { id: "testing-individual", field: "teamSize", operator: "max", value: 1, factIds: ["national-software-testing:v2:eligibility"], note: "本记录个人赛，不采用高职团队规则。" }],
    task: "根据网页需求设计能够发现错误的测试，用脚本和截图让另一个人复现你发现的问题。",
    roles: [{ name: "功能测试与自动化", task: "把需求拆成正常、边界和组合用例，再写稳定脚本验证结果", skills: ["programming", "writing"], evidence: "你能展示一个普通输入通过、边界输入失败的例子，并说明为什么这属于缺陷吗？", output: "需求—用例表、自动化脚本和缺陷复现记录" }],
    gain: "完成后能保留质量工程的个人证据，展示从需求到反例的推理；找到了多少截图不等于发现了多少独立缺陷。",
    entry: "会基本网页操作并能说明预期结果即可开始手工用例；自动化还需Python或Java及调试基础。", completion: "难点是用例有效、脚本稳定和证据相互一致，不能靠重复截图或无断言脚本堆数量。",
    investment: "编辑建议先三次各一小时测试一个自有练习网页，再用四周每周4—6小时补脚本；只在获授权测试目标上练习。",
    fit: ["喜欢找反例和解释软件为什么出错", "愿意整理可以复现的证据"], avoid: ["不愿读需求就批量生成无意义测试", "准备扫描未授权的真实网站"],
    trial: { action: "对自有或获授权的练习表单写正常、空值、边界和组合用例，选两条自动化并保存结果。", output: "用例表、两个测试脚本及一项复现说明", check: "另一人可按步骤复现，脚本断言能区分正确与故意改坏的行为。", reflection: "你喜欢定位错误、设计反例还是把证据写清楚？" },
    remaining: ["当前届次规则、评分和工具版本须重新核验", "2025教师登记存在自行参赛分支，不据‘一名指导教师’强制排除无导师学生"],
    deepCase: authoredDeepCase({ seriesId: "national-software-testing", missing: ["未取得具体官方赛题或完整公开参赛作品；赛项概述不能满足L3真实案例门槛"], task: "2025官方代表任务：针对给定Web应用与需求文档提交测试用例、脚本和截图。", title: "Web测试任务拆解：需求到可复现缺陷", sourceIds: ["testing-2025-track"], boundary: "已读官方赛项说明；下列练习方法是编辑拆解，没有取得当场题目的应用或冒称获奖答案。", steps: ["将需求拆成可观察的输入与预期结果，注明每条需求涉及的页面和前置条件。", "设计正常、等价类、边界和组合用例，说明每条用例试图区分哪一种错误。", "实现脚本并加断言，重跑排除偶然失败，截图对应准确操作节点。", "把需求编号、用例编号、脚本和截图逐项关联，清理重复证据并记录无法验证的范围。"], questions: ["脚本失败是环境问题还是产品缺陷？", "截图与用例中的前置条件是否一致？", "删除这个断言会漏掉哪种错误？"], rubrics: [["用例充分性与复现性", "编辑检查：需求覆盖表及另一人的独立复现。"], ["代码用例一致性与可运行性", "编辑检查：脚本断言、重复运行与失败定位。"], ["关键截图证据", "编辑检查：每张图能定位需求与操作状态。"]], roles: [{ role: "个人测试者", steps: ["读需求建用例", "运行并定位差异", "整理脚本与截图证据"], contributionProof: "本人用例修改记录和失败修复说明" }], weeks: [["选一个获授权练习网页并拆需求", "每条需求都有明确预期结果"], ["设计边界和组合用例", "能说明至少两条用例发现不同错误"], ["实现自动化并检查稳定性", "同一环境重复运行结果可解释"], ["整理缺陷复现与证据索引", "另一人能按材料复现一项缺陷"]], exits: ["没有合法测试目标时使用本地练习应用", "暂时不会编程时先完善手工用例，不用生成脚本冒充独立能力"] })
  }
];
