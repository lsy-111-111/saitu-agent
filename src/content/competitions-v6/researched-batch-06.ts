import { readSource, authoredDeepCase, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-06-reading-log.json" });
export const researchBatch06: ResearchedContent[] = [
  {
    seriesId: "aiaa-design-build-fly", authorAgentId: "/root/continue_catalog", name: "AIAA Design/Build/Fly", organizer: "AIAA", aliases: ["AIAA DBF"], editionId: "2025-2026", edition: "2025—2026赛季（历史）", groupId: "university-team", group: "符合会员及学段组成条件的高校队", scopeId: "2026-charter-flight", scope: "2026规则与Charter Flight任务解析；下一届题目与规则另核", trackId: "aircraft-missions", trackName: "电动遥控固定翼系统设计", taskFamily: "engineering-prototype", subjectDomains: ["engineering"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026赛季现场赛4月16—19日结束；下一届任务与报名尚未在本记录核定，不能用历史包判断当届报名或合规。",
    sources: [source("aiaa-dbf-2026-rules", "https://aiaa.org/wp-content/uploads/2025/08/2026-DBF-Rules.pdf", "2025-26 Design, Build, Fly Rules", "AIAA", "2026完整规则；本条解析任务二和通用资格、交付、评分", "PDF第5、8—9、19—20、26—29、32—34页")],
    verified: {
      eligibility: { text: "学生成员须全日制高校在读及AIAA学生会员，至少三分之一非本科毕业年级，研究生至多三分之一且有额外行业经历限制；每校一队，可多校合队。", source: 0 },
      track: { text: "同架电动遥控飞机完成试飞、载客货和拖横幅任务，另有地面任务；本条解析2026载客货收益权衡。", source: 0 },
      participation: { text: "先交提案和名单获邀，再交设计报告并参加现场技术检查和飞行；飞手须AMA会员，可为非学生，学生负责设计制造。", source: 0 },
      deliverables: { text: "提案最多6页PDF；设计报告最多60页，另交一页构型图；实机须与报告构型相符，现场依规则完成任务。", source: 0 },
      rubric: { text: "报告合分按提案15%、设计报告85%；总分将报告分乘任务分再加参与分。任务二按净收入相对最佳队归一化，不只比载重。", source: 0 },
      investment: { text: "2026规则第9页规定，提交所需设计报告和构型图、具备Fly-off资格的队伍须在到场前缴纳550美元/队注册费；不按成员人数自动均摊，不包含会员、材料、保险与旅行，也不代表个人总费用。", source: 0 }
    },
    eligibilityFacts: [{"idSuffix": "team-entry", "text": "各校仅可提交一支队伍；至少三分之一为低年级、研究生至多三分之一，例外需批准；只有提案获选队伍受邀参加fly-off。", "sourceIds": ["aiaa-dbf-2026-rules"]}, {"idSuffix": "membership", "text": "所有学生队员须为AIAA学生会员；可使用非学生飞手，但所有飞手均须具AMA会员身份，并在fly-off签到核验。", "sourceIds": ["aiaa-dbf-2026-rules"]}],
    eligibilityRules: [{ id: "dbf-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["aiaa-design-build-fly:v2:eligibility"], note: "学生队员要求，不套用于允许的外聘飞手。" }, { id: "dbf-member", field: "membership", operator: "requires_confirmation", value: "AIAA学生会员；飞手另需AMA会员", factIds: ["aiaa-design-build-fly:v2:eligibility.membership"], note: "按实际角色核实。" }, { id: "dbf-composition", field: "priorQualification", operator: "requires_confirmation", value: "队伍三分之一学段比例、学校唯一名额与提案入围", factIds: ["aiaa-design-build-fly:v2:eligibility.team-entry"], note: "个人学年不能证明整队组成合格。" }],
    task: "把飞行任务转成重量、能量、结构和操作约束，比较不同设计，并用可追溯测试证明系统能完成任务。",
    roles: [{ name: "任务分析与系统取舍", task: "将计分目标转成设计变量，比较载荷、航速与电池容量的影响", skills: ["data-analysis", "mechanical-design", "research"], evidence: "增加电池后续航与评分成本怎样同时变化，你依据什么选容量？", output: "任务计算表、敏感性分析和设计取舍记录" }, { name: "结构制作与验证", task: "在学校安全条件下制作和检查部件，把测试结果回写设计", skills: ["hardware", "mechanical-design"], evidence: "哪项试验改变了你的设计，怎么判定测试不足以支持飞行？", output: "图纸版本、检查与试验记录" }, { name: "报告与项目组织", task: "组织角色、预算、图纸和证据索引，保持实际构型与报告一致", skills: ["writing", "team-management"], evidence: "如何从一个性能结论追到计算或测试原始记录？", output: "报告、里程碑与构型变更台账" }],
    gain: "能积累系统工程和验证证据；竞赛成绩并不意味着设计获民航认证或可在任意地点飞行。",
    entry: "先做任务计算和纸面结构取舍；正式实机需要学校场地、培训、飞手及安全检查，不适合无资源个人直接开工。", completion: "难在多任务共用构型、重量与能量耦合、制造误差和实际飞行可靠性；最高理论分未必能安全完成。",
    investment: "编辑建议四周先做任务分析与地面模型，完整飞行项目通常需更长校队周期；加工、电池、保险、会员和出境支出本条不设虚假总额。",
    fit: ["愿意用测试修正设计而非只画图", "能在校队里承担明确子系统工作"], avoid: ["没有受训人员和合规场地却准备试飞", "把历史赛题尺寸和规则当本届通用要求"],
    trial: { action: "根据2026任务二计分公式做电子表格，比较三组载荷、电池和圈数假设，标明哪些性能尚无测试支持。", output: "敏感性表与一页设计取舍说明", check: "改变一个参数时能解释收入和成本如何同时变化，而不是仅选择最大载荷。", reflection: "你更喜欢分析取舍、制造结构还是管理验证过程？" },
    remaining: ["2027规则、安全Q&A与国际团队旅行要求需重新核验", "只完成纸面试算不证明实机可飞；正式预算未知"],
    deepCase: authoredDeepCase({ seriesId: "aiaa-design-build-fly", task: "2026任务二Charter Flight：在五分钟任务窗口内携带规定客货载荷飞行，以净收入及相对队伍表现计分，并成功着陆。", title: "真实命题拆解：为什么多装电池和货物未必得高分", sourceIds: ["aiaa-dbf-2026-rules"], boundary: "已读2026规则任务二原题、计分、资格及报告要求；下列为编辑的分析方法，不提供未经测试的飞机设计，也不是获奖作品。", steps: ["先建立约束表：技术检查申报载荷、共用飞机配置、任务顺序和成功着陆条件；不合规方案不能靠高计算分补救。", "把客货数量、圈数与电池能量分成决策量和待测试结果，用官方收入减成本关系建表；圈数不能假设为任意可选。", "固定两项条件、改变另一项做敏感性比较，记录增加载荷或电池可能降低速度、提高重量的耦合；这是待验证假设而非官方额外规则。", "将纸面结果与地面、结构和飞行验证需求对应，写出何时必须停止试验或降低任务目标；最后解释相对归一化使绝对收益不能直接等同名次。"], questions: ["把圈数当独立变量会漏掉哪些工程约束？", "净收益计算正确是否足以证明能获得任务分？", "为何只优化任务二可能损害总任务表现？"], rubrics: [["任务二净收入及成功飞行", "编辑证据：可复算表、所有假设来源、实际性能验证和着陆条件检查。"], ["报告与系统任务组合", "编辑证据：任务需求到子系统及测试的对应表，明确纸面预测与实测差异。"]], roles: [{ role: "任务分析", steps: ["整理公式和限制", "建敏感性表", "提出需实测的性能假设"], contributionProof: "公式校核记录、参数来源与本人分析结论" }, { role: "验证组织", steps: ["列地面检查", "由合格人员评估试验条件", "记录失败并更新设计"], contributionProof: "测试申请、检查清单和设计变更依据" }], weeks: [["读任务二并制作限制与变量表", "区分硬约束、公式和个人假设"], ["实现并交叉校验净收入表", "两人独立试算同一组假设得到一致结果"], ["比较三种载荷电池组合", "说明耦合与未取得的性能证据"], ["形成设计取舍与验证计划", "每个性能结论对应依据，安全条件不足时不进入实飞"]], exits: ["无法取得学校安全训练和场地时停留在桌面分析", "模型对圈数假设过度敏感时先补实测依据，不购买或制作整机"] })
  }
];
