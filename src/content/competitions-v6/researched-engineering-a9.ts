import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/engineering-a-reading-log.json" });
const rules = source("fsc-2026-rules-cost", "https://img.sae-china.org/web/2026/04/2026%E4%B8%AD%E5%9B%BD%E5%A4%A7%E5%AD%A6%E7%94%9F%E6%96%B9%E7%A8%8B%E5%BC%8F%E7%B3%BB%E5%88%97%E8%B5%9B%E4%BA%8B%E8%A7%84%E5%88%99%EF%BC%88%E6%9C%80%E7%BB%88%E7%89%88%EF%BC%89.pdf", "2026中国大学生方程式系列赛事规则最终版", "中国汽车工程学会", "2026燃油组资格和成本与制造分析，不套用电车学生例外", "PDF第13—14、17—18、138—142页；A4/A5/A7/A8及S4", "2026-04-10");
const task = source("fsc-2026-cost-case", "https://img.sae-china.org/web/2026/02/FSC_2026_%E6%A1%88%E4%BE%8B%E5%88%86%E6%9E%90%E9%A2%98%E7%9B%AE.pdf", "2026成本项目案例分析题目", "中国大学生方程式系列赛事组委会", "2026赛车公司扩产订单案例，中英文四页", "完整4页，中文题目与六条提示", "2026-02-27");
export const engineeringResearchA9: ResearchedContent[] = [{
  seriesId: "formula-student-china", name: "中国大学生方程式系列赛事", organizer: "中国汽车工程学会", aliases: ["FSC", "FSCC"], authorAgentId: "/root/continue_catalog",
  editionId: "2026-fscc", edition: "2026燃油组规则档案", groupId: "university-combustion", group: "高校燃油车队", scopeId: "china-2026-fscc-cost", scope: "2026燃油组成本与制造分析岗位", origin: "legacy_135", trackId: "cost-manufacturing", trackName: "成本与制造：扩产订单案例", taskFamily: "business-practice", subjectDomains: ["engineering", "management", "economics"], factStatus: "historical", registrationStatus: "historical", registrationNote: "保留2026具体命题供学习；不将规则发布等同当前开放报名，下一赛季另核。",
  sources: [rules, task],
  verified: {
    eligibility: { text: "2026燃油组学生为所在院校注册的全日制本科生和全日制研究生，比赛时毕业不超过7个月有例外；研究生至多3人，本科大三及以下至少3人，队员须满18岁。学校须为学会团体会员或注册后两个月内加入，教师1—5名；驾驶员另须有效驾照。", source: 0 },
    track: { text: "本岗位不是独立个人商赛，而是车队成本与制造分析项目。2026案例要求评估分三年增量订单的成本、利润、设计优化和谈判目标。", source: [0, 1] },
    participation: { text: "以学校车队在赛事管理系统注册，同校同类型通常一队；按期限提交材料，并在现场结合实际赛车接受审查和讨论。", source: 0 },
    deliverables: { text: "成本报告包含车辆BOM及辅助工程材料；成本岗位还需现场陈述和案例分析。报告须与真实车辆及制造工艺对应，练习表不能替代整车参赛材料。", source: 0 },
    rubric: { text: "成本与制造分析表7.2总分100分：最低成本项目20分，按BOM的调整后成本排序；准确性，清晰性40分；现场比赛日/制造流程40分。第三项要求详细讨论赛前公布的案例，细化目标及评分说明由组委会另行发布。", source: 0 },
    investment: { text: "2026规则规定中国赛团队注册费5000元人民币或800美元，不退还；车辆、运输及个人承担比例另核，不把5000元当个人总预算。", source: 0 }
  },
  eligibilityRules: [{ id: "fsc-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["formula-student-china:v2:eligibility"], note: "A4.1.1全日制要求适用于本科生及研究生；毕业七个月例外另核" }, { id: "fsc-degree", field: "degree", operator: "in", value: ["undergraduate", "master", "doctorate"], factIds: ["formula-student-china:v2:eligibility"], note: "燃油组，研究生人数限制另核" }, { id: "fsc-age", field: "age", operator: "min", value: 18, factIds: ["formula-student-china:v2:eligibility"], note: "队员满18岁" }, { id: "fsc-team", field: "priorQualification", operator: "requires_confirmation", value: "在读/毕业七个月例外、研究生和低年级人数、学校会员、校方教师及正式车队", factIds: ["formula-student-china:v2:eligibility"], note: "不以个人学历替全队确认；成本岗位不强加驾驶员驾照条件" }],
  task: "用工程和成本证据判断一份扩产订单是否值得承接，并解释性能改进与投入的取舍。",
  roles: [{ name: "成本与经营分析", task: "区分固定投入、单位变动成本与产能瓶颈，说明利润依赖的假设", skills: ["accounting-finance", "data-analysis", "writing"], evidence: "当订单上涨而设备不足时，哪项成本不会线性变化？", output: "本人模型、依据和敏感性分析" }, { name: "制造与设计沟通", task: "将真实部件和工艺改动映射到BOM与性能验证", skills: ["engineering", "research", "presentation"], evidence: "你建议的改动凭什么既改善性能又能制造？", output: "设计变更、工艺比较与测试依据" }],
  gain: "可形成连接工程、成本和决策表达的作品；车队规模或赛事名称不能替代个人负责的分析与证据。",
  entry: "先用题目做简化成本表，再理解车队BOM与工艺；喜欢汽车的商科学生也需学会核对工程假设。",
  completion: "案例分析要解释订单成本、性能优化和产能假设。正式成本报告以车辆BOM和实际制造工艺为依据；整车完赛还依赖全队技术检查和动态项目。",
  investment: "编辑建议四周每周4—6小时先用已有电脑和表格工具做纸面案例，不购车或设备。正式加入车队的制造、场地、运输和经费须另确认。",
  fit: ["喜欢用数字解释工程取舍", "愿意向技术队友核实而非凭空填成本"], avoid: ["将案例岗位误当可个人报名的独立比赛", "把题目假设的订单当真实市场需求"],
  trial: { action: "按题目三年订单制作收入、产能和扩产投入表，选择两项未知成本做区间分析。", output: "注明题设与自拟假设的三年成本表", check: "题目数量和报价保持一致；不将未知设备、厂房和人力填成零。", reflection: "你更愿意做成本模型，还是追查设计变化的工程依据？" },
  remaining: ["当前报名窗口、完整个人成本及校队名额未核", "保险和非驾驶员证件条款存在不同表述，实际注册要求须向组委会核实"],
  deepCase: authoredDeepCase({
    seriesId: "formula-student-china", task: "2026成本案例：在原有产能基础上评估200、500、800辆的三年订单。", title: "将扩大订单的收入与扩产代价放在同一张决策表", sourceIds: [rules.id, task.id],
    boundary: "案例题第1—2页的扩产订单、性能正优化及追加设备、厂房和人员投入，属于题设公司的分析情境。提示5按题设公司的产量解释标准表，提示6要求估算追加投入。正式成本报告按赛事规则S4.5.1使用年产1000辆的标准表口径，排除研发和基础设施建设经费。个人参赛费用按实际校队条件另核。",
    steps: ["固定题设订单与报价，将现有成本、产能和新增投入分列。", "逐年检查产能缺口，给厂房、设备、人员、物流等自拟条件附依据或区间。", "对一项设计改动作性能收益与成本比较，区分官方标准表和真实市场估算的用途。", "检验悲观条件下是否仍有利润，将结论转为需要沟通的价格、交期或分担事项。"],
    questions: ["扩产是否需要先支付投入，利润为正是否仍可能资金不足？", "降低成本靠可实现的设计变化，还是遗漏了必要工序？", "案例已改变标准表产量口径，你是否仍机械沿用1000辆假设？"],
    rubrics: [["最低成本项目20分", "表7.2按BOM的调整后成本排序，按式(7-1)计分。"], ["准确性，清晰性40分", "评审赛车零部件、制造可行性、成本信息和辅助文件的准确性与全面性。"], ["现场比赛日/制造流程40分", "车队准备详细讨论赛前公布的案例，项目目标及评分细则由组委会另发。"]],
    roles: [{ role: "成本建模", steps: ["整理题设", "建立产能与成本表", "比较敏感性"], contributionProof: "本人公式、数据依据和假设变化记录" }, { role: "设计论证", steps: ["提取部件方案", "比较工艺与性能", "形成谈判依据"], contributionProof: "本人方案对照与工程证据索引" }],
    weeks: [["拆解题设和成本口径", "所有已知与未知有标记"], ["建立三年扩产模型", "不遗漏固定投入和能力约束"], ["比较设计改动与不确定性", "说明哪些条件改变结论"], ["完成董事会式简报并质询", "结论可回溯，新增假设有说明"]],
    exits: ["拿不到车队真实BOM时保留为明确标注的案例练习", "模型对未知成本极敏感时先补证据，不急于给确定盈利结论"]
  })
}];
