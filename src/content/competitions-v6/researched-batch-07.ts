import { readSource, authoredDeepCase, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-07-reading-log.json" });
export const researchBatch07: ResearchedContent[] = [
  {
    seriesId: "national-supply-chain", name: "全国供应链大赛", organizer: "中国物流与采购联合会、中国物流学会", aliases: [], editionId: "2026-7", edition: "2026第七届（历史省赛）", groupId: "undergraduate", group: "本科组（含职业本科）", scopeId: "china-practical-provincial", scope: "供应链实战赛项本科省赛；不与商贸赛项或职工组混用", trackId: "practical-supply-chain", trackName: "供应链运营实战", taskFamily: "business-practice", subjectDomains: ["management", "economics"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026报名4月15日截止；历史训练不代表当届开放或已获平台账号。",
    sources: [{ ...source("supplychain-2026-rules", "https://jwc.zjhzu.edu.cn/_upload/article/files/3f/5d/38e3c4e94f1b879d3dc93f0d4288/ce2b3a21-79f9-47c1-b298-e3d0b4dcf013.pdf", "关于举办第七届全国供应链大赛的通知及细则", "中物联、中国物流学会（浙江湖州学院托管原件）", "2026全国规则及附件1供应链实战省赛", "PDF第1—7页；全国初决赛仅作阶段区分", "2026-03-20"), authority: "official_host" }],
    verified: {
      eligibility: { text: "相关专业全日制本科及职业本科按本科组参赛，每队4名同校学生，可跨年级专业；每校每赛项最多两队，需1—2名本校专职教师指导。", source: 0 },
      track: { text: "供应链实战与商贸运营是分别报名的赛项，学生不得两项兼报；省赛实战模拟一年企业供应链运营。", source: 0 },
      participation: { text: "领队或队长在中物联平台报名；省赛、全国初赛在线进行，后续决赛另行通知。", source: 0 },
      deliverables: { text: "在指定平台完成融资、竞标、选址、生产、采购和配送等决策，赛前15分钟规划，季度间暂停复盘；每人须有联网电脑。", source: 0 },
      rubric: { text: "省赛按实战平台综合分排名，同分比较净资产；全国初赛规划平均分与运营各50%，不能将该比例套入省赛。", source: 0 }
    },
    eligibilityRules: [{ id: "supply-degree", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["national-supply-chain:v2:eligibility"], note: "职业本科在本组，高职专科另组。" }, { id: "supply-team", field: "teamSize", operator: "eq", value: 4, factIds: ["national-supply-chain:v2:eligibility"], note: "四名学生。" }, { id: "supply-same", field: "sameInstitutionTeam", operator: "eq", value: true, factIds: ["national-supply-chain:v2:eligibility"], note: "不跨校。" }, { id: "supply-mentor", field: "mentor", operator: "eq", value: true, factIds: ["national-supply-chain:v2:eligibility"], note: "本校专职教师。" }],
    task: "在动态市场中协调采购、生产、库存和交付，用经营数据检验决策是否改善整体供应链。",
    roles: [{ name: "供需与库存分析", task: "比较需求预估、供应周期和库存风险", skills: ["data-analysis", "accounting-finance"], evidence: "库存降低是否同时增加了缺货，你如何判断整体效果？", output: "供需表、库存策略与决策日志" }, { name: "运营协调", task: "把生产、采购和配送决策组织成一致的执行顺序", skills: ["team-management", "presentation"], evidence: "哪个决策依赖另一个岗位的信息，沟通失误怎样被发现？", output: "分工表、经营复盘与风险清单" }],
    gain: "能形成经营取舍和团队决策证据；模拟平台分数不是实际企业盈利能力，等级证书还另有成绩与申领条件。",
    entry: "理解收入、成本、库存等基本概念可先做纸面情景；正式参赛须落实四人同校队与指导教师。", completion: "难点是把局部最优与整体现金、供货和交付约束协调，避免只追单一指标。",
    investment: "编辑建议四周每周4小时先做模拟表；官方文件未列总报名支出，账号、设备及差旅由学校确认，不能由校赛免费支持推出全程免费。",
    fit: ["喜欢比较有代价的经营选择", "愿意持续记录决定和结果"], avoid: ["只想凭直觉点平台按钮", "无法组织同校队伍或落实指导"],
    trial: { action: "用自拟并标明为练习的数据，比较小批频繁采购与大批低价采购两种方案，加入一次需求突增。", output: "四周期库存现金表与决策解释", check: "同时说明缺货、库存和现金变化，能解释哪个假设改变了选择。", reflection: "你更喜欢分析数字、安排流程还是协调团队？" },
    remaining: ["未取得具体比赛平台场景数据或完整作品，不把通用平台流程算L3", "本届个人全部费用与平台综合分内部权重未知"]
  },
  {
    seriesId: "zhongshe-social-service-skills", name: "中社杯全国大学生社会服务实践技能大赛", organizer: "中国社会工作教育协会、全国智慧社会工作行业产教融合共同体", aliases: [], editionId: "2026-2", edition: "2026第二届（历史）", groupId: "undergraduate", group: "本科组", scopeId: "china-2026", scope: "第二届本科组，不沿用首届评分PDF", trackId: "social-service-practice", trackName: "项目或实务案例与实务模拟", taskFamily: "teaching-service", subjectDomains: ["law", "management"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "第二届报名1月31日截止、文本3月12日截止；现场最终安排未再核验。",
    sources: [{ ...source("zhongshe-2026-notice", "https://www.myunion.com.cn/news/detail/6972d887546cdb0b3587b167.html", "第二届中社杯全国大学生社会服务实践技能大赛启动通知", "赛事技术单位美亚联创发布中国社会工作教育协会通知", "2026第二届资格、交付、阶段评分、费用及作品使用条款", "参赛要求、赛事流程、参赛费及特别声明", "2026-01-19"), authority: "official_host", verificationMethod: "agent_web_read" }],
    verified: {
      eligibility: { text: "社会工作等社会服务相关专业全日制在校学生按学段分组，每队3—5人同校同学段，需1—2名本校专任教师；每校每组至多三队。", source: 0 },
      track: { text: "初赛选择项目报告或实务案例，其后从核心服务环节制作实务模拟；现场按指定实务题设计方案并答辩。", source: 0 },
      participation: { text: "团队在线登记、资格审查、地区初赛与全国决赛；作品匿名，学校盖章报名材料与学生身份证明另交。", source: 0 },
      deliverables: { text: "文本交背景、服务做法或计划、实施评估和专业反思；晋级交模拟视频，现场交方案及PPT展示。", source: 0 },
      rubric: { text: "总分为实务模拟40%加现场60%；现场内部方案60%、答辩40%。细项表未读取，不借用首届文本权重。", source: 0 },
      investment: { text: "初赛每队200元，决赛另800元；交通住宿保险自理，现场餐食由组委会提供。通知含共同作品权利和宣传出版条款，提交前应明确授权。", source: 0 }
    },
    eligibilityRules: [{ id: "social-degree", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["zhongshe-social-service-skills:v2:eligibility"], note: "本条本科组，不跨学段。" }, { id: "social-min", field: "teamSize", operator: "min", value: 3, factIds: ["zhongshe-social-service-skills:v2:eligibility"], note: "三至五人。" }, { id: "social-max", field: "teamSize", operator: "max", value: 5, factIds: ["zhongshe-social-service-skills:v2:eligibility"], note: "含负责人。" }, { id: "social-same", field: "sameInstitutionTeam", operator: "eq", value: true, factIds: ["zhongshe-social-service-skills:v2:eligibility"], note: "同校。" }, { id: "social-mentor", field: "mentor", operator: "eq", value: true, factIds: ["zhongshe-social-service-skills:v2:eligibility"], note: "本校专任指导。" }],
    task: "把服务对象的需求、专业方法、实施过程与效果评估连成可反思的服务方案，避免把热心等同有效帮助。",
    roles: [{ name: "需求与服务设计", task: "区分服务对象表达、观察证据与自己的假设，确定可评估目标", skills: ["fieldwork", "research", "writing"], evidence: "服务目标是谁提出的，怎样知道服务对象真正受益？", output: "匿名需求分析、目标与评估设计" }, { name: "模拟与协作反思", task: "在教学模拟里呈现沟通方法并记录伦理界限", skills: ["presentation", "team-management"], evidence: "遇到自己能力范围外的问题时，何时转介或求助？", output: "模拟脚本、观察反馈和专业反思" }],
    gain: "可积累服务评估、沟通和反思材料；计划和角色模拟不能包装成已实现的真实服务成效。",
    entry: "先学基本社会工作价值与方法，在指导下做虚构情境练习；接触真实对象需落实知情同意、隐私和机构程序。", completion: "难在需求准确、方法合适、效果有依据和专业边界清晰，不能只靠感人的叙述。",
    investment: "编辑建议四周每周4小时做教学模拟与评估计划；真实服务周期与经费依机构，团队报名费不直接平摊为已确定个人总成本。",
    fit: ["愿意倾听并反思自己的假设", "关注帮助是否产生可观察的效果"], avoid: ["把拍摄服务对象当作作品素材而忽略同意", "打算虚构服务结果或越过专业边界"],
    trial: { action: "与指导者选一个虚构服务情境，写目标、方法、风险和评估指标，再进行一次不涉及真实个案的角色模拟。", output: "方案、模拟反馈与反思清单", check: "每个目标有可观察指标，并能解释一个应转介或停止的情形。", reflection: "你更喜欢需求理解、方案设计还是现场沟通？" },
    remaining: ["未读取第二届细项评分附件和真实公开完整作品，不计L3", "首届PDF不是第二届依据；作品使用条款需团队及所在机构确认"]
  },
  {
    seriesId: "china-undergraduate-physics-tournament", authorAgentId: "/root/continue_catalog", roleEvidenceField: "deliverables", name: "中国大学生物理学术竞赛", organizer: "中国大学生物理学术竞赛竞赛委员会", aliases: ["CUPT"], editionId: "2020-rules", edition: "2020规则与历史题学习", groupId: "undergraduate", group: "本科生团队", scopeId: "china-historical-2020", scope: "2020版全国规则和明确采用的IYPT2020题；2026华北另列来源，不混写新资格", trackId: "physics-fight", trackName: "物理探究与学术辩论", taskFamily: "experimental-research", subjectDomains: ["science"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "本记录是历史题学习，不提供2020或2026当前报名；2026承办方通知证实系列仍举办，但不使2020规则变成现行规则。",
    sources: [{ ...source("cupt-2020-rules", "https://jwc.ecust.edu.cn/_upload/article/files/37/7f/056b829b414e9ee2268c1beb2775/6f94229e-2725-47d6-a854-79d2997a269b.pdf", "中国大学生物理学术竞赛简介及比赛规则2020版", "CUPT（华东理工大学托管原件）", "2020全国规则、明确采用IYPT2020题目", "PDF第3—8页资格、角色与评分"), authority: "official_host" }, source("iypt-2020-problem6", "https://iypt.org/problems/iypt-2020-problems/", "Problems for the 33rd IYPT 2020", "IYPT IOC", "CUPT2020规则明确采用的题集；第6题Saxon Bowl", "第6题完整题干", "2019-07-14"), { ...source("cupt-2026-north-notice", "https://ss.imust.edu.cn/info/1053/4852.htm", "2026 CUPT华北赛区第三轮通知", "CUPT华北赛区承办方内蒙古科技大学", "仅证明2026举办及新规则应另核，不支撑2020资格", "赛事题目、队伍与2026年6月5—7日安排", "2026-06-02"), authority: "official_host" }],
    verified: {
      eligibility: { text: "2020全国规则为本科生、不限年级专业，通常5人，特殊情况3—4人；以学校团队报名、领队可为教师或学生，不能个人直报全国赛。", source: 0 },
      track: { text: "2020采用IYPT2020开放问题，通过理论、实验和学术辩论研究；IYPT自身高中资格不转用于CUPT本科系列。", source: 0 },
      task: { text: "IYPT2020第6题“Saxon Bowl”给出底部有孔的碗放入水后会下沉，要求研究决定沉没时间的参数。", source: 1 },
      participation: { text: "区域与全国分阶段，按当年学校名额和资格参赛；轮流担任正方、反方、评论方及观摩方。", source: 0 },
      deliverables: { text: "正方报告实验设计、结果、理论和结论，反方针对其论证质疑，评论方评价双方；报告应包含可检查的研究证据。", source: 0 },
      rubric: { text: "2020角色表现由裁判打分，正方、反方、评论方通常按3、2、1加权；拒题会影响正方系数，不能忽略规则调整。", source: 0 }
    },
    eligibilityFacts: [{"idSuffix": "school-qualification", "text": "2020全国赛资格按区域赛及规程的学校名额确定；不接受个人报名，主办校及邀请高校有原文限定例外。", "sourceIds": ["cupt-2020-rules"]}],
    eligibilityRules: [{ id: "cupt-degree", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["china-undergraduate-physics-tournament:v2:eligibility"], note: "2020历史规则。" }, { id: "cupt-max", field: "teamSize", operator: "max", value: 5, factIds: ["china-undergraduate-physics-tournament:v2:eligibility"], note: "通常5人，少于5人需特殊情况确认。" }, { id: "cupt-school", field: "priorQualification", operator: "requires_confirmation", value: "所在学校当届区域/全国资格", factIds: ["china-undergraduate-physics-tournament:v2:eligibility.school-qualification"], note: "不以个人本科身份推断全国参赛资格。" }],
    task: "研究一个没有预设唯一解的物理现象，用实验与模型回答参数怎样影响结果，并能接受有依据的质疑。",
    roles: [{ name: "实验与模型", task: "控制变量、记录误差并比较模型预测与观察", skills: ["lab-research", "data-analysis", "research"], evidence: "哪组数据最不支持你的解释，为什么没有删掉它？", output: "实验记录、误差分析和模型比较" }, { name: "学术讨论", task: "准确复述对方结论，区分证据漏洞和表达不清", skills: ["presentation", "writing"], evidence: "你的反驳针对哪条证据，怎样的补充会改变判断？", output: "报告、质疑问题与修订说明" }],
    gain: "可训练开放探究和证据讨论；漂亮演示或单次成功实验不等于稳定结论，更不证明已获得科研成果。",
    entry: "可从可观察的低风险现象开始，先会控制变量和记数据；正式校队需更系统准备多个题目。", completion: "难在实验重复性、模型适用边界和现场回应，不能只背结论或把讨论变成语言压制。",
    investment: "编辑建议四周每周4—6小时研究一个小题；耗材与设备按学校条件确认，历史费用不用于预测当前个人支出。",
    fit: ["喜欢问现象为什么发生", "愿意保留异常数据并修改解释"], avoid: ["只想背标准答案", "不愿意让他人检查实验和推理"],
    trial: { action: "对历史第6题沉没小碗做纸面变量分析；若有适合的防水容器，在指导下用清水重复记录，不使用电器靠近水。", output: "变量表、重复测量或明确标注的实验计划", check: "能区分孔径、初始载荷与容器差异，解释为何一次计时不能代表规律。", reflection: "你更喜欢设计实验、处理数据还是讨论解释？" },
    remaining: ["2026全国与赛区新规需另读；旧版流程总时长文字与表格不一致，本条不引用总时长", "本例是历史题编辑分析，不是已完成优秀作品"],
    deepCase: authoredDeepCase({ seriesId: "china-undergraduate-physics-tournament", task: "CUPT2020采用题集第6题Saxon Bowl：底部有孔的小碗置于水面会逐渐下沉，研究决定下沉时间的参数。", title: "真实开放题拆解：让沉没时间成为可解释测量", sourceIds: ["cupt-2020-rules", "iypt-2020-problem6"], boundary: "2020规则明确采用IYPT2020；已读第6题完整题干。下列为编辑设计的研究路线，不宣称得到官方标准答案或实测结论。", steps: ["定义开始计时与完全沉没的判据，记录碗的形状、质量、孔径及水面条件，使不同实验可比较。", "提出进水与浮力变化的候选模型，把不易控制的形状差异与主要自变量区分；预测必须写在测试之前。", "一次只改变一个主要条件并重复计时，记录波动和无法判断终点的情况；不把偶然最快的一次当规律。", "比较模型与数据偏离，讨论漏水口流动、碗倾斜等替代解释，准备让反方指出证据缺口并据此修改。"], questions: ["沉没判据改变会怎样影响结果？", "碗形变化与孔径变化能否被混为一个效应？", "哪种反例会迫使你放弃现有模型？"], rubrics: [["正方的实验与理论论证", "编辑证据：操作定义、控制变量、重复测量和预测偏差。"], ["反方质疑与评论", "编辑证据：针对具体证据的问题及能够改变判断的补充条件，不只作主观评价。"]], roles: [{ role: "实验记录者", steps: ["定义测量", "记录重复与异常", "整理误差"], contributionProof: "原始计时、实验条件照片与修订记录" }, { role: "模型与讨论者", steps: ["写候选解释", "提出可反驳预测", "用对方质疑修订"], contributionProof: "模型版本、反例和修改理由" }], weeks: [["读原题并界定测量", "写出至少三项待控条件"], ["完成小规模重复观察", "保留全部记录并解释异常"], ["检验一个候选模型", "说明支持与不支持的结果"], ["模拟正反评论讨论", "每条质疑都落到证据或假设"]], exits: ["无法安全控制实验条件时先做纸面设计", "重复误差大到无法比较时先改测量，不急于声称发现规律"] })
  }
];
