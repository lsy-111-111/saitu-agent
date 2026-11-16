import { readSource, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/batch-05-reading-log.json" });
export const researchBatch05: ResearchedContent[] = [
  {
    seriesId: "psychology-undergraduate-innovation-forum", authorAgentId: "/root/continue_catalog", name: "全国高校心理学专业本科生创新创业论坛", organizer: "教育部高等学校心理学类专业教学指导委员会", aliases: ["心理实验设计分论坛"], editionId: "2026", edition: "2026（历史选拔）", groupId: "psychology-undergraduate", group: "心理学专业本科个人", scopeId: "china-experimental-design", scope: "2026心理实验设计分论坛，不套用产品设计或短视频团队条件", trackId: "experimental-design", trackName: "心理实验设计", taskFamily: "experimental-research", subjectDomains: ["science", "education"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026项目提交已于5月25日结束；现场新命题与最终举办安排本记录未核验。",
    sources: [{ ...source("psychology-2026-notice", "https://jwb.bnuzh.edu.cn/docs/2026-03/94468b7ed4ae4ab3b1610a3dd0360737.pdf", "2026全国高校心理学专业本科生创新创业论坛第一轮通知", "心理学教指委（北京师范大学珠海校区托管原件）", "2026心理实验设计分论坛选拔；不采用有矛盾的短视频现场安排", "PDF第1—3页、6—8页", "2026-03-04"), authority: "official_host" }],
    verified: {
      eligibility: { text: "心理实验设计限心理学专业在读本科生个人参与、不设指导教师；须普通全日制学籍和学校盖章在学证明，每人仅参加一个分论坛。", source: 0 },
      track: { text: "提出心理学研究问题并设计可行实验；本分论坛与现实问题解决、产品设计和科普视频分别组织。", source: 0 },
      participation: { text: "培养单位校内选拔、原则上每分论坛推荐不超过一项，学校注册和提交；入围现场后另给新命题。", source: 0 },
      deliverables: { text: "交立项依据与问题、研究设计方法、数据结果解释、特色创新四部分材料，另交五分钟以内配音PPT视频；多媒体不得泄露身份。", source: 0 },
      rubric: { text: "选拔看问题表述准确、实验科学可行、亮点创新和文本可读；不得使用既有教师科研项目或研究工作作为作品。", source: 0 }
    },
    eligibilityFacts: [{"idSuffix": "school-recommendation", "text": "培养单位组织校内选拔，原则上每分论坛推荐不超过一项；选手须提交教务部门盖章的在学证明。", "sourceIds": ["psychology-2026-notice"]}],
    eligibilityRules: [{ id: "psy-degree", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["psychology-undergraduate-innovation-forum:v2:eligibility"], note: "仅本科个人实验设计。" }, { id: "psy-major", field: "major", operator: "in", value: ["心理学", "应用心理学"], factIds: ["psychology-undergraduate-innovation-forum:v2:eligibility"], note: "原文心理学专业范围，其他相近专业须另确认，不因兴趣自动满足。" }, { id: "psy-team", field: "teamSize", operator: "max", value: 1, factIds: ["psychology-undergraduate-innovation-forum:v2:eligibility"], note: "不套用其他分论坛团队名额。" }, { id: "psy-school", field: "priorQualification", operator: "requires_confirmation", value: "培养单位推荐名额与在学证明", factIds: ["psychology-undergraduate-innovation-forum:v2:eligibility.school-recommendation"], note: "个人准备不等于可绕过学校提交。" }],
    task: "把心理现象写成可检验问题，设计能够区分不同解释的实验，说明测量、混杂因素和结果的含义。",
    roles: [{ name: "独立研究设计者", task: "界定变量、提出替代解释并设计比较条件", skills: ["research", "data-analysis", "writing"], evidence: "为什么结果变化能归因于你研究的因素，而不是练习或顺序效应？", output: "变量表、实验流程、替代解释与分析计划" }],
    gain: "可留下研究设计与科学论证过程；实验构思不是临床诊断能力，未开展或未取得的数据必须明确标注。",
    entry: "先掌握基本实验设计和测量概念；正式资格受专业和校内名额限制，其他专业可先做学习练习。", completion: "难在控制混杂、方法可执行、结果解释克制；‘不设指导教师’不免除学校适用的伦理审查。",
    investment: "编辑建议四周每周4—6小时形成设计与复盘；先做文献和模拟数据练习，招募和实验费用未核实。",
    fit: ["愿意比较多个心理现象解释", "能将模糊想法改成可观察变量"], avoid: ["把网络测评当成诊断工具", "计划编造实验数据或跳过参与者保护程序"],
    trial: { action: "选择一个学习注意现象，写两种解释与区分它们的实验计划，先用明确标注的模拟数据检查分析流程。", output: "一页设计、混杂控制表和模拟数据说明", check: "能指出至少一个潜在混杂，并说明什么结果不支持原假设。", reflection: "你更喜欢观察现象、设计实验还是分析证据？" },
    remaining: ["未取得2026现场具体新命题或完整公开作品，不计L3", "第一轮通知短视频现场描述存在冲突；本记录限定无此冲突的实验设计分论坛", "费用与最终现场日程未知"]
  },
  {
    seriesId: "china-data-journalism", authorAgentId: "/root/continue_catalog", name: "中国数据新闻大赛", organizer: "中国数据新闻大赛组委会", aliases: [], editionId: "2026-11", edition: "2026第十一届（海南赛区历史）", groupId: "student-team", group: "队长单位归属海南赛区的学生团队", scopeId: "hainan-2026", scope: "海南赛区官方启动公告；不将另一AIGC赛事拆入数据新闻计数", trackId: "data-journalism", trackName: "数据新闻作品", taskFamily: "investigation", subjectDomains: ["literature", "science", "arts"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "本公告报名6月30日、作品7月7日截止；只描述2026历史流程。",
    sources: [{ ...source("datajournalism-2026-hainan", "https://webplus.hainnu.edu.cn/_s58/2026/0515/c2514a165201/page.psp", "第十一届中国数据新闻大赛海南省赛区启动公告", "海南省赛区组委会、海南师范大学承办学院", "2026海南赛区数据新闻部分，不外推其他省收费或提交流程", "第一部分资格、评分、提交、规则与时间节点；98—230行", "2026-05-19"), authority: "official_host" }],
    verified: {
      eligibility: { text: "学生及其他数据新闻爱好者可组3—6人团队，赛区按队长所在单位确定；每人最多两队、仅一队担任队长。", source: 0 },
      track: { text: "以真实数据和公共问题开展新闻叙事，可规范使用AI，但须保持事实、来源、方法和标注可追溯。", source: 0 },
      participation: { text: "队长在指定系统报名、成员缴费后完善团队资料，省赛选拔进入全国环节；高校组须注明指导教师。", source: 0 },
      deliverables: { text: "交报名及阐述、授权、教师信息、盖章原创声明、作品链接、封面和作品PDF等；提交后内容不可再修改，网页须保持可访问。", source: 0 },
      rubric: { text: "六方面为选题、价值导向、数据质量与方法、叙事可视化、技术交互、AI使用规范；公告没有给数值权重。", source: 0 },
      investment: { text: "该公告数据新闻报名每人100元，可参与本赛事最多两队；另报AIGC须另缴，不能当一次费用覆盖两项。", source: 0 }
    },
    eligibilityFacts: [{"idSuffix": "faculty-advisor", "text": "海南赛区公告数据新闻部分规定高校组作品应注明指导教师；此要求不外推非高校组或其他赛区。", "sourceIds": ["datajournalism-2026-hainan"]}],
    eligibilityRules: [{ id: "news-team-min", field: "teamSize", operator: "min", value: 3, factIds: ["china-data-journalism:v2:eligibility"], note: "本赛区团队3—6人。" }, { id: "news-team-max", field: "teamSize", operator: "max", value: 6, factIds: ["china-data-journalism:v2:eligibility"], note: "不以作者人数代替登记成员人数。" }, { id: "news-region", field: "region", operator: "requires_confirmation", value: "队长单位归属海南赛区", factIds: ["china-data-journalism:v2:eligibility"], note: "其他地区需读取对应赛区通知。" }, { id: "news-mentor", field: "mentor", operator: "eq", value: true, factIds: ["china-data-journalism:v2:eligibility.faculty-advisor"], note: "公告对高校组明确要求注明指导教师。" }],
    task: "从可追溯数据中找到值得解释的公共问题，用准确图表和叙事让读者看懂结论、证据与局限。",
    roles: [{ name: "资料核查与数据分析", task: "核对口径、清洗和分析数据，检查结论对缺失或异常值的敏感性", skills: ["research", "data-analysis"], evidence: "若换一项统计口径，你的结论是否还成立？", output: "来源台账、清洗记录和复现表" }, { name: "新闻叙事与可视化", task: "组织读者问题和图文顺序，避免图表比例造成误导", skills: ["writing", "design", "presentation"], evidence: "读者能区分相关性、原因和你尚不知道的内容吗？", output: "叙事稿、图表及标注检查表" }],
    gain: "能留下兼具新闻判断与数据复现的作品；入围不保证媒体发表、实习或个人升学加分。",
    entry: "会查公开资料和使用表格即可开始一张图；正式作品还需落实团队、教师及数据许可。", completion: "难在数据口径、叙事取舍和技术稳定同时成立，不能用漂亮图表掩盖数据缺失。",
    investment: "编辑建议四周每周4—6小时完成一个小主题；除公告报名费，还需考虑网页托管、授权或调研成本，是否学校承担另问。",
    fit: ["愿意追查数字从哪里来", "希望把分析结果讲给非专业读者"], avoid: ["只想复制公开图表不核验口径", "计划把AI生成内容当成未标注的真实采访"],
    trial: { action: "用一份有许可的公共数据做一张图和300字说明，记录清洗步骤、缺失值和一个可能误读。", output: "图文样稿、来源链接与复现步骤", check: "另一人可复现关键数字，标题不夸大数据能支持的结论。", reflection: "你更喜欢找问题、处理数据还是安排阅读体验？" },
    remaining: ["只采用海南赛区职责范围内公告，不宣称全国各省规则相同", "未读取完整优秀作品和具体获奖评审，不计L3"]
  },
  {
    seriesId: "vocational-small-animal-clinical-skills", authorAgentId: "/root/continue_catalog", name: "高职院校小动物临床诊疗技能大赛", organizer: "中国兽医协会", aliases: [], editionId: "2026", edition: "2026（历史）", groupId: "vocational", group: "高职院校在籍学生团队", scopeId: "china-2026", scope: "2026中国兽医协会高职赛，不与雄鹰杯或本科动物医学技能赛合并", trackId: "clinical-skills", trackName: "理论与临床技能操作", taskFamily: "experimental-research", subjectDomains: ["agriculture"], origin: "verified_expansion", factStatus: "historical", registrationStatus: "historical", registrationNote: "报名2026年4月7日截止、比赛4月22日，当前仅用于历史准备参考。",
    sources: [source("cvma-vocational-2026", "https://www.cvma.org.cn/6848/202604/73246.html", "2026年高职院校小动物临床诊疗技能大赛通知", "中国兽医协会", "2026全国高职院校赛资格、组成、权重与费用", "比赛内容、参赛对象和其他事项；203—267行", "2026-04-02")],
    verified: {
      eligibility: { text: "选手须为参赛学校在籍学生，学校最多两队，需盖章报名并核验身份；通知定位高职院校，不推定普通本科可参加。", source: 0 },
      track: { text: "理论机考与六项临床技能结合，涵盖输液、注射、气道、导尿、缝合和复苏训练。", source: 0 },
      participation: { text: "团队两名成员一人操作一人辅助；每位选手登记1—2名指导教师，确认后不得随意更换。", source: 0 },
      deliverables: { text: "现场完成20分钟60题机考及规定技能操作；赛前学校交盖章回执、学生照片等，不是线上提交临床视频替代操作。", source: 0 },
      rubric: { text: "总评理论20%、技能80%，同总分按答题时间排名；具体技能评分需另读赛项规程，不能从总权重反推单项分值。", source: 0 },
      investment: { text: "不收报名费，交通和食宿自理；免费报名不代表个人参赛总支出为零。", source: 0 }
    },
    eligibilityFacts: [{"idSuffix": "faculty-advisor", "text": "每名参赛选手登记一至两名指导教师，报名确认后选手及教师不得随意更换。", "sourceIds": ["cvma-vocational-2026"]}, {"idSuffix": "team-size", "text": "团队两名成员共同完成规定技能，一人操作、另一人辅助。", "sourceIds": ["cvma-vocational-2026"]}],
    eligibilityRules: [{ id: "vet-degree", field: "degree", operator: "in", value: ["vocational"], factIds: ["vocational-small-animal-clinical-skills:v2:eligibility"], note: "高职院校范围；职业本科分类需主办方确认。" }, { id: "vet-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["vocational-small-animal-clinical-skills:v2:eligibility"], note: "本校在籍与学校推荐。" }, { id: "vet-team", field: "teamSize", operator: "eq", value: 2, factIds: ["vocational-small-animal-clinical-skills:v2:eligibility.team-size"], note: "一操作一辅助。" }, { id: "vet-mentor", field: "mentor", operator: "eq", value: true, factIds: ["vocational-small-animal-clinical-skills:v2:eligibility.faculty-advisor"], note: "指导教师必须落实。" }],
    task: "在专业教师监督和合规教学条件下练习临床技能协作，准确说明操作依据、记录与异常情况。",
    roles: [{ name: "技能操作者", task: "按已培训项目执行并识别应停止或求助的条件", skills: ["lab-research", "presentation"], evidence: "出现异常时你会如何停止并向指导者报告？", output: "教师评阅的训练记录与复盘" }, { name: "辅助与记录", task: "核对训练用物、与操作者沟通并完整记录关键状态", skills: ["team-management", "writing"], evidence: "你如何确认双方理解一致，怎样记录未完成项目？", output: "协作核对表与交接记录" }],
    gain: "经监督完成的训练可证明规范意识和团队协作；参赛经历不是兽医执业资格，不授权独立诊疗。",
    entry: "需具备相关专业课程基础和教师监督条件；零基础先做理论、器材识别与模拟模型观察。", completion: "难在操作稳定、两人沟通、动物福利和异常处理；不能仅靠观看视频替代训练与考核。",
    investment: "编辑建议先在学校安排下每周两次模型练习；设备耗材、实验室和差旅依学校资源，未落实指导时不要自行对动物操作。",
    fit: ["愿意接受教师反馈并规范记录", "喜欢细致操作与相互核对的团队工作"], avoid: ["没有训练资质和监督却计划用真实动物练习", "把竞赛得奖等同可独立执业"],
    trial: { action: "请指导教师提供一个非侵入模型练习或操作录像，按课程核对表观察，标出操作者与辅助者的沟通节点。", output: "观察记录、沟通节点图及待问问题", check: "能区分已掌握、仅观察和需再次训练的部分，并由教师确认。", reflection: "你更喜欢操作、观察记录还是解释原理？" },
    remaining: ["技能规程附件未用于本批逐项评分，无完整代表任务解析，不计L3", "未来届次、高职与职业本科具体资格须另核验"]
  }
];
