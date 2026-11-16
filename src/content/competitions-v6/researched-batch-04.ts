import { readSource, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-04-reading-log.json" });
export const researchBatch04: ResearchedContent[] = [
  {
    seriesId: "hackharvard", name: "HackHarvard", organizer: "HackHarvard", aliases: [], editionId: "2026-11", edition: "2026第11届（历史）", groupId: "student", group: "符合居住地成年条件的学生", scopeId: "onsite-digital-trust", scope: "2026现场Digital Trust赛道；未读取完整法律规则", trackId: "digital-trust", trackName: "金融科技与网络安全", taskFamily: "software-algorithms", subjectDomains: ["engineering", "economics"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026年10月16—18日活动已结束；网站公开概览不保证下一届录取或地区资格。",
    sources: [source("hackharvard-2026-overview", "https://hackharvard2026.devpost.com/", "HackHarvard2026: Hack to the Moon", "HackHarvard在Devpost的官方赛事页", "2026现场赛通用提交、评审与Digital Trust任务", "Who can participate、Requirements、Digital Trust和Judging Criteria")],
    verified: {
      eligibility: { text: "公开概览限定学生且达到居住地法定成年年龄；地区存在例外。完整法律规则未读取，不能将概览解释为所有中国学生均可参赛。", source: 0 },
      track: { text: "Digital Trust要求开发改善数字金融或网络安全的项目，例如识别欺诈、保护个人财务与隐私。", source: 0 },
      participation: { text: "仅接受现场参赛团队提交，需在Devpost选择希望参加的赛道，并在现场接受评审。", source: 0 },
      deliverables: { text: "交赛事期间创建的公开GitHub仓库，视频可选且最多3分钟，另有3分钟现场展示；2026提交截止为10月18日上午8时美国东部时间。", source: 0 },
      rubric: { text: "通用评审四项等权：创新与影响、技术复杂度、功能与可用性、团队合作与学习；不能把赞助商其他奖项标准混入。", source: 0 }
    },
    eligibilityRules: [{ id: "hh-student", field: "enrolled", operator: "eq", value: true, factIds: ["hackharvard:v2:eligibility"], note: "仅依据2026学生范围。" }, { id: "hh-age", field: "age", operator: "requires_confirmation", value: "居住地法定成年年龄", factIds: ["hackharvard:v2:eligibility"], note: "按司法辖区核实，不统一写成18岁。" }, { id: "hh-region", field: "region", operator: "requires_confirmation", value: "完整规则地区例外及现场录取", factIds: ["hackharvard:v2:eligibility"], note: "概览未列明的例外保持未知。" }],
    task: "选一个数字信任问题，用可运行的小工具展示它怎样减少用户误判或暴露，解释实际能力和失败边界。",
    roles: [{ name: "安全问题与原型", task: "界定威胁场景，制作原型并用自建样本检查误报漏报", skills: ["programming", "research", "data-analysis"], evidence: "工具会错误拦截什么正常行为，你如何测出来？", output: "威胁场景、原型、测试样本及限制说明" }, { name: "用户体验与演示", task: "把风险提示做成用户能够理解的操作，并压缩为短演示", skills: ["design", "presentation"], evidence: "使用者是否理解提示，而不是无条件相信工具？", output: "交互原型、反馈记录和演示脚本" }],
    gain: "可积累需求选择、协作和原型测试证据；演示能运行不代表达到金融生产系统或安全产品的可靠性。",
    entry: "会做一个小网页或能用纸面交互说明风险即可先体验；不需要一开始训练复杂模型。", completion: "难点是短时协作中把真实问题、技术实现、可用性和演示连起来，并承认误报及未覆盖威胁。",
    investment: "编辑建议先用四个晚上完成本地演示；正式现场需核实录取、出行与食宿，未读取费用条款，不能承诺低预算可赴现场。",
    fit: ["愿意让原型接受反例测试", "喜欢在分工中快速做出可演示结果"], avoid: ["希望远程作品自动获得现场参赛资格", "准备未经许可测试真实账户或攻击第三方服务"],
    trial: { action: "在自建的虚构支付流程里设计一条可疑操作提示，用正常与异常样本各测三次。", output: "本地交互演示与误报漏报表", check: "能演示一个有效提醒和一个失败情形，并解释用户下一步该如何验证。", reflection: "你更喜欢识别问题、实现逻辑还是解释风险？" },
    remaining: ["完整法律规则返回403，队伍人数、地区例外、知识产权与费用未核实", "已读官方赛道命题但没有完整公开参赛作品，不计L3"]
  },
  {
    seriesId: "acm-student-research", name: "ACM Student Research Competition", organizer: "ACM及承办学术会议", aliases: ["ACM SRC"], editionId: "2026-chi", edition: "2026 CHI分站（历史）", groupId: "undergraduate", group: "本科研究组", scopeId: "chi-2026", scope: "ACM SRC的CHI2026本科分站，不把其他会议分站重复计为系列", trackId: "hci-research", trackName: "人机交互学生研究", taskFamily: "investigation", subjectDomains: ["engineering", "arts", "education"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "CHI2026分站已公布获奖，提交截止2026年1月22日；其他会议和下一年度另核。",
    sources: [source("acm-src-chi2026", "https://chi2026.acm.org/authors/student-research-competition/", "CHI2026 Student Research Competition", "ACM CHI2026", "本科组资格、论文初评与现场轮；非其他分站通用文件限制", "Eligibility、Preparing、Selection、At the Conference、Funding")],
    verified: {
      eligibility: { text: "初次截止时须大学在读，本科可个人或本科生团队，导师不署名；本科完成的研究允许研一按本科组提交。入选报告者须有有效ACM学生会员。", source: 0 },
      track: { text: "提交已完成或进行中的原创人机交互研究，不能与其他会刊同时投稿或重复发表；团队成员只呈现自己的贡献。", source: 0 },
      participation: { text: "线上初评后在CHI现场海报评审，入围者再口头报告；本届无混合或远程参赛。", source: 0 },
      deliverables: { text: "初稿最多5页、不含参考文献，实名、可访问PDF，另交英文在读证明（不接受成绩单或学生证扫描替代）；入选后制作海报。", source: 0 },
      rubric: { text: "初稿30分：问题动机5、相关研究5、方法独特性10、结果贡献10；海报45分和口头轮35分另评，不能合并为同一百分制。", source: 0 },
      investment: { text: "本赛道不提供经费；入选者须注册并现场出席。扩展摘要免开放获取APC，但会员、会议及差旅不能据此认定免费。", source: 0 }
    },
    eligibilityRules: [{ id: "src-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["acm-student-research:v2:eligibility"], note: "按初次提交截止时核验。" }, { id: "src-undergrad", field: "degree", operator: "requires_confirmation", value: "本科研究或研一提交本科阶段成果", factIds: ["acm-student-research:v2:eligibility"], note: "含明确例外，不按当前学位一刀切。" }, { id: "src-member", field: "membership", operator: "requires_confirmation", value: "入选报告者须有ACM学生会员", factIds: ["acm-student-research:v2:eligibility"], note: "这是入选后的条件，不改写为初投前必须已付费。" }],
    task: "把一个人机交互问题转成研究问题，交代现有工作、方法、观察结果和你实际新增的认识。",
    roles: [{ name: "研究设计与分析", task: "选择可检验问题并区分观察、解释与泛化范围", skills: ["research", "data-analysis", "writing"], evidence: "什么结果会推翻你的假设，样本能支持多大范围的结论？", output: "研究问题、方法记录、分析及局限" }, { name: "原型与可访问表达", task: "使交互原型和论文图表能被目标用户理解和访问", skills: ["design", "programming", "presentation"], evidence: "你的设计决定依据什么反馈，替代文本能传达图表结论吗？", output: "原型版本、可访问PDF和海报草稿" }],
    gain: "完整研究能形成方法与贡献证据，初投或入选本身不等于发表高水平完整论文；团队需明确个人工作范围。",
    entry: "先会提出可检验问题、阅读少量相关研究；涉及人的研究须落实所在机构适用的伦理程序。", completion: "难在原创性、方法可信度、清楚的贡献边界和可访问表达，不是把产品介绍改写成研究摘要。",
    investment: "编辑建议四周每周6小时完成一个方法草案与可行性试验；正式论文周期依研究而定，出行注册费另查。",
    fit: ["愿意质疑自己的设计假设", "希望把项目转成有方法和证据的研究"], avoid: ["只想展示产品而不解释研究贡献", "不准备披露方法局限或个人贡献"],
    trial: { action: "比较同一功能的两种界面，写一页可检验研究问题与方法；先做个人走查，需招募参与者时先确认伦理及同意程序。", output: "问题、相关工作、方法和可能反证的一页计划", check: "能说明测试的是哪项假设，结果将怎样改变设计。", reflection: "你更喜欢做产品，还是解释产品为什么有效？" },
    remaining: ["获奖名单只是索引，尚未读取一篇完整公开SRC作品，因此不计L3", "其他ACM会议的篇幅、资格及经费不自动沿用CHI2026"]
  },
  {
    seriesId: "asme-sme-manufacturing-design", authorAgentId: "/root/continue_catalog", name: "ASME/SME Student Manufacturing Design Competition", organizer: "ASME MED、SME NAMRI", aliases: ["SMDC学生制造设计竞赛"], editionId: "2026", edition: "2026（历史）", groupId: "undergraduate", group: "本科学生设计", scopeId: "msec-namrc-2026", scope: "2026制造工程设计赛，不同于ASME Student Design Competition机器人赛", trackId: "manufacturing-design", trackName: "制造系统、部件或工艺设计", taskFamily: "engineering-prototype", subjectDomains: ["engineering"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026报名3月16日截止、现场展示6月15日；页面页脚2027会期不属于本届赛规。",
    sources: [source("smdc-2026-rules", "https://namrc.sme.org/competitions/student-manufacturing-design-competition/", "ASME/SME Student Manufacturing Design Competition", "SME NAMRI", "2026制造设计赛完整网页规则；资格段年份原文保留", "Requirements、Process、Judging、Eligibility、Conference Registration")],
    verified: {
      eligibility: { text: "本科或研究生可个人或团队；资格原文写全日制在校持续至2024春或以后，日期口径须复核，不能擅改为2026。研究生还受是否适合会议其他展示渠道限制。", source: 0 },
      track: { text: "原创制造系统、部件或工艺设计，可涉及自动化、增减材、材料工艺或节能制造；不是统一机器人题。", source: 0 },
      participation: { text: "电子报告初选，入围后在会议现场展示；参赛材料必须有教师支持者签名。未完成实物的方案可按设计与分析参评。", source: 0 },
      deliverables: { text: "提交1500—3000词PDF报告及图照，列项目、学生联络人和教师签名；决赛15分钟报告、5分钟问答。", source: 0 },
      rubric: { text: "按问题表达、需求满足、分析可信度、设计创意、目标驱动试验及成本质量可持续指标等评审；现场还看展示质量。", source: 0 },
      investment: { text: "入围每队提供一份免费会议注册，可申请最多500美元差旅支持，但差旅仍由学生或教师承担；申请不等于必获。", source: 0 }
    },
    eligibilityFacts: [{"idSuffix": "faculty-sponsor", "text": "参赛报告须列出教师支持者姓名、签名及完整联系方式。", "sourceIds": ["smdc-2026-rules"]}],
    eligibilityRules: [{ id: "smdc-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["asme-sme-manufacturing-design:v2:eligibility"], note: "资格段在读日期仍须复核。" }, { id: "smdc-date", field: "enrolled", operator: "requires_confirmation", value: "原文2024春或以后全日制在校口径", factIds: ["asme-sme-manufacturing-design:v2:eligibility"], note: "不把网页可能残留年份自动修成2026。" }, { id: "smdc-mentor", field: "mentor", operator: "eq", value: true, factIds: ["asme-sme-manufacturing-design:v2:eligibility.faculty-sponsor"], note: "报告要求教师支持者签名。" }],
    task: "提出一项制造设计改进，用分析与目标明确的试验解释它相对现有做法改善了什么，又付出了什么代价。",
    roles: [{ name: "制造设计与验证", task: "从工艺需求出发选择结构或流程，并定义可测的质量与效率指标", skills: ["mechanical-design", "data-analysis", "hardware"], evidence: "哪项测量支持改进，是否只把成本转移到了另一工序？", output: "设计比较、计算依据、试验计划与指标表" }, { name: "技术报告", task: "把需求、设计、分析和贡献对应到可核查图表", skills: ["writing", "presentation"], evidence: "另一位工程人员能从报告复查关键假设吗？", output: "报告、图表来源及成员贡献说明" }],
    gain: "可留下工程取舍和验证思路，尚未完成实物时仅称设计分析，不能声称已达到量产性能。",
    entry: "可从熟悉的一道制作流程开始比较，需有教师支持才能按本历史规则正式参赛。", completion: "难在需求量化、分析假设合理、试验能检验目标和对制造成本的诚实比较。",
    investment: "编辑建议先四周每周5小时做桌面设计；加工、实验室、耗材与赴会成本依方案，必须先确认设备安全培训和经费。",
    fit: ["愿意用测量比较不同制造方案", "能取得教师支持并留下工程过程记录"], avoid: ["仅凭效果图宣称性能提升", "没有加工权限却计划直接操作设备"],
    trial: { action: "选一个可安全观察的装配或制作步骤，比较两种设计，列出材料、时间、误差与维护代价。", output: "两案比较表、关键计算和试验草案", check: "至少一个改进指标可实际测量，且明确一项可能变差的指标。", reflection: "你更喜欢结构构思、动手验证还是分析工艺？" },
    remaining: ["资格段2024春日期口径待主办方确认，正式推荐保持条件未知", "没有读取完整公开参赛作品；一般设计主题不计L3"]
  }
];
