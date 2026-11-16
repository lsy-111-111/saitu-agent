import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/learning-d1-reading-log.json" });
const rules = source("chi-d1-2025-rules", "https://chi2025.acm.org/for-authors/student-research-competition/", "CHI2025 Student Research Competition规则与获奖名单", "ACM SIGCHI", "2025 CHI分站本科组资格、交付、三阶段评分及实际入选作品", "Eligibility、Preparing、Selection Process、At the Conference、Winners；历史届次", null);
const work = { ...source("chi-d1-chemlab-work", "https://kimsieun.com/pdfs/chemlabplanner.pdf", "Designing an Educational Tool to Improve Understanding and Planning in Chemistry Laboratory Courses", "Sieun Kim／ACM CHI EA 2025", "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282", "第1—6页全文，表1及图1—8；第5页图7/8已渲染视觉核对", "2025-04"), authority: "other" as const };
const deep = authoredDeepCase({
 seriesId:"acm-student-research", task:"分析CHI2025本科SRC公开作品ChemLab Planner：把62人调查、5人访谈、教育设计与3人初步试用分开，构建可追溯的研究证据链。", title:"完整公开作品：调查发现怎样支持教育工具设计", sourceIds:[rules.id,work.id],
 boundary:"同届官方页面列该作品为本科组第二名，作者6页公开论文全文已读；使用公开成果作学习分析，不声称复现研究、获得原始数据或通过真实用户评价。研究对象是实验课程准备，但本练习只评读调查与教学设计，不进行化学实验。",
 steps:["把三个研究问题改写为调查困难、形成设计依据、实现支持工具三个层次。逐项列出62名有实验课经历本科生的问卷、5人追访与3人非正式试用各能回答什么，不能混成70个互不重叠样本。", "以表1中手册充分性和图3/4为例，区分自报感受、问卷项间差异与学习效果。样本均为韩国学生且多为化学相关专业；不能把统计显著等同全国普遍性或因果作用。", "将缺少步骤解释、手册与现场不符、多人计划三种困难对应图7的步骤拆分、环境输入和时间线；逐条写出需求证据与设计假设。作者原型使用模型生成，本练习只离线分析图示，不调用模型或照搬实验步骤。", "按论文第5.2和6.1节区分三名受试者的主观有用反馈与尚待开展的正式效果研究。写一个未来比较方案的变量与测量计划，不实际招募或收集个人资料，也不把计划写成结果。"],
 questions:["62人调查、5人追访和3人试用能否直接相加？", "认为工具有帮助是否证明学习效果提高？", "图7哪项功能有需求证据，哪项效果仍待验证？"],
 rubrics:[["书面评审：问题5、背景5、方法独特性10、结果贡献10", "编辑练习把研究问题、已有研究差距、证据获取方法和有限结论分别列出，不编造新颖性或论文分数。"],["海报评审：方法15、贡献10、口头10、视觉10", "用一页证据链清楚连接问卷、访谈、设计和试用；为每一结论标论文位置与限制。"],["最终报告：领域知识15、贡献10、展示10", "准备解释样本、设计取舍和未验证效果，准确区分个人评读贡献与原作者工作。"]],
 roles:[{role:"调查方法分析者",steps:["拆研究问题与样本", "核对问卷和结论", "标记外推边界"],contributionProof:"本人问题—证据表、页码定位及一条过度结论的修订理由"},{role:"教学设计评读者",steps:["将学习困难对应支持功能", "比较新手与熟练者需要", "提出可检验学习目标"],contributionProof:"本人目标—活动—测量表，注明第6.3节适应不同水平仍为未来工作"}],
 weeks:[["整理研究问题和三种证据来源", "明确样本重叠可能性与每种证据边界"],["对照一项问卷结果与对应设计功能", "保留原文定位且不将感受改写成因果效果"],["提出一个不涉及真实招募的比较设计", "变量、测量和潜在混杂分别标明且没有伪造结果"],["写成一页评读与三分钟口头说明", "按官方方法和贡献评分自查但不冒充正式评分"]],
 exits:["缺少方法基础时只做问题—证据—结论表，不做统计复算", "真正开展用户研究前须有合适伦理安排和招募条件；公开评读不等于正式参赛成果"]
});
export const learningResearchD1: ResearchedContent[] = [{
 seriesId:"acm-student-research",name:"ACM Student Research Competition",organizer:"ACM及承办学术会议",aliases:["ACM SRC"],authorAgentId:"/root/audit_catalog",editionId:"2025-chi",edition:"2025 CHI分站（历史）",groupId:"undergraduate",group:"本科研究组",scopeId:"chi-2025-undergrad",scope:"2025 CHI本科SRC，具体公开作品为ChemLab Planner；不回填2026或其他分站",trackId:"hci-education-research",trackName:"教育人机交互调查研究",taskFamily:"investigation",subjectDomains:["engineering","education","science"],origin:"verified_expansion",factStatus:"historical",registrationStatus:"historical",registrationNote:"初投截止2025年1月23日AoE，会议与颁奖均已结束；公开作品用于学习，不表示下一届可报。",
 sources:[rules,work], verified:{
 eligibility:{text:"初投截止时须在大学或学院在读；本科可个人或全本科团队，研一可提交本科阶段研究这一例外须核实。指导教师不能列为作者，入选报告者须具备有效ACM学生会员并注册会议。",source:0},
 track:{text:"CHI分站面向人机交互学生研究；本条采用同届本科组公开获奖作品进行方法学习，不把教育工具题材说成官方统一命题。",source:0},
 participation:{text:"初投扩展摘要与学籍证明，入选后现场海报评审，各组前三进入报告问答；2025明确必须现场参与。",source:0},
 deliverables:{text:"初投至多8页正文、不含参考文献，署名而非匿名；学籍证明须英文且不接受扫描证件或成绩单。入选带现场海报，另提交不超过4MB的单页letter PDF；初投不要求视频。",source:0},
 rubric:{text:"书面评审30分：问题5、背景5、方法独特性10、结果贡献10；海报45分：口头10、视觉10、方法15、贡献10；最终报告35分：知识15、贡献10、展示10。三个阶段不可相加当单场满分110。",source:0},
 investment:{text:"官方要求入选报告者会议注册、ACM学生会员和现场出席，所读页面未列完整费用；旅行资助可申请不等于一定获得或个人费用为零。",source:0}},
 eligibilityRules:[{id:"chi-d1-enrolled",field:"enrolled",operator:"eq",value:true,factIds:["acm-student-research:v2:eligibility"],note:"以2025年1月初投截止时学籍为准"},{id:"chi-d1-undergrad",field:"degree",operator:"requires_confirmation",value:"本科研究，或研一提交本科阶段成果",factIds:["acm-student-research:v2:eligibility"],note:"不将例外简化成当前本科唯一条件"},{id:"chi-d1-membership",field:"membership",operator:"requires_confirmation",value:"入选报告者ACM学生会员及现场注册",factIds:["acm-student-research:v2:eligibility"],note:"入选后的条件，会议费用和出行另核"}],
 task:"把真实学习困难变成可研究的问题，用调查和公开证据支撑设计，诚实区分设计建议与已验证效果。",
 roles:[{name:"调查与证据分析",task:"梳理问题、方法、样本与结论，追踪证据限制",skills:["research","writing","data-analysis"],evidence:"你如何说明问卷感受不能单独证明学习效果？",output:"方法证据表、边界说明与修订意见"},{name:"教学设计分析",task:"把学习困难对应支持功能与未来评价指标",skills:["research","design","writing"],evidence:"新手提示与熟练者核对提示为什么不同？",output:"学习目标、功能和评价对应表"}],
 gain:"形成调查研究评读、教育设计分析和科学表达的个人作品；不能把原作者研究或获奖归为本人经历。",entry:"新手可用提供的中文说明从证据表开始；正式研究需要文献阅读、方法与伦理安排。",completion:"难点是让研究问题、数据和贡献对应，且可说清样本、测量及外推限制；漂亮原型不能代替有效证据。",investment:"编辑建议四周每周2—4小时进行公开论文评读；已有电脑时小型离线证据表无需采购、模型调用或真人招募。正式研究与现场参赛成本另核。",
 fit:["愿意用证据理解真实学习问题","能区分观察、解释与尚未验证的设计"],avoid:["想用三条好评证明普遍有效","准备把别人的公开研究写成本人成果"],
 trial:{action:"使用目录中文说明，将62人问卷、5人访谈、3人试用分别写成证据卡，标出各自不能支持的结论。",output:"三张证据卡与一处过度结论的改写",check:"不相加样本、不把主观帮助当因果效果，不进行真人调查或化学操作。",reflection:"你更喜欢调查方法、教学设计，还是清楚讲述证据？"},
 remaining:["未获得问卷原始数据，不能独立复算统计结果","当届之外的报名资格、费用和公开作者后续正式评价未核"],deepCase:{...deep,workedExample:{...deep.workedExample,origin:"published_work"}}
}];
