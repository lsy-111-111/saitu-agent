import { readSource, authoredDeepCase, type ResearchedContent } from "./research-types";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/software-math-c2-reading-log.json" });
export const softwareMathResearchC2: ResearchedContent[] = [
  {
    seriesId: "china-software-cup", name: "中国软件杯大学生软件设计大赛", organizer: "中国软件杯大学生软件设计大赛组委会", aliases: ["软件杯"], authorAgentId: "/root", editionId: "2026-15", edition: "2026第十五届A3（历史）", groupId: "a-higher-education", group: "A组本科、研究生、高职", scopeId: "china-a3-2026", scope: "2026 A3科大讯飞多智能体题；不套用B组资格或其它题评分", trackId: "a3-learning-agents", trackName: "个性化资源生成与学习多智能体", taskFamily: "software-algorithms", subjectDomains: ["engineering", "education"], origin: "legacy_135", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026官网通知的报名与初赛提交期已结束，仅作历史题学习。",
    sources: [source("softcup-c2-notice", "https://www.cnsoftbei.com/content-74-1250-1.html", "第十五届中国软件杯大赛通知", "大赛组委会", "2026全国大赛组队、流程、费用", "参赛资格、初赛作品要求及费用原文；curl读取正文", "2026-03-24"), source("softcup-c2-a3", "https://www.cnsoftbei.com/content-3-1286-1.html", "A3个性化资源生成与学习多智能体系统开发", "大赛组委会／科大讯飞", "2026 A3完整题干、评分和交付", "基本功能、非功能、实现条件、评分及初赛提交全文", "2026-04-01")],
    verified: {
      eligibility: { text: "全日制高校学生可组队，A3明确本科、研究生、高职；报名队伍含队长一名、其他学生至多两名及一个指导教师名额，可跨校组队。导师须为学生所在院校专职教师；多位导师时按“xx大学指导组”登记，证书体现为指导组，如需列出具体导师姓名的证明，要在报名截止前发送学校、团队、导师及分工材料，决赛结束后再从同一邮箱提出申请。参赛软件须由团队在本届大赛期间原创，决赛结束前已在其他比赛或平台展出、获奖的作品及雷同作品不得参赛。", source: [0, 1] },
      track: { text: "A3针对一门高校专业课程开发多智能体学习系统，智能体开发框架不限，但开发中其他AI辅助工具须用科大讯飞相关工具；须通过对话形成不少于六维画像，协作生成至少五类资源并规划学习路径。", source: 1 },
      participation: { text: "团队网上报名并选择企业题，按当届初赛要求交作品，晋级后参加后续评审；一名学生只能担任一支团队的队长。初赛须在作品提交系统交电子报名表并注明学生分工，决赛现场报到另交盖章的纸质版。", source: 0 },
      deliverables: { text: "初赛提交注明成员职责的电子报名表、演示PPT、可运行的代码/数据/配置、七分钟以内演示视频和开发测试文档。决赛现场另交盖章纸质报名表。使用其他 AI 辅助工具须按题目选科大讯飞相关工具，使用 AI Coding 须说明，并标注开源及工具协议。", source: [0, 1] },
      rubric: { text: "A3各项大致占比为创新价值与实用性35%、功能实现及技术要求45%、配套文档10%、演示视频和PPT10%；智能辅导与学习效果评估是可选加分功能。", source: 1 },
      investment: { text: "大赛不收参赛费，决赛食宿自理；A3未限定硬件但可能需要模型与生成资源，不能将报名免费等同总成本零。", source: [0, 1] }
    },
    eligibilityRules: [{ id: "softcup-students", field: "teamSize", operator: "max", value: 3, factIds: ["china-software-cup:v2:eligibility"], note: "三位学生之外另有一位导师。" }, { id: "softcup-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["china-software-cup:v2:eligibility"], note: "全日制高校在校生。" }, { id: "softcup-mentor", field: "mentor", operator: "eq", value: true, factIds: ["china-software-cup:v2:eligibility"], note: "导师任职范围须进一步确认。" }],
    task: "把一门课程的知识材料、学生对话与学习反馈串成能解释推荐依据的多智能体学习产品。",
    roles: [{ name: "需求与教学资源", task: "整理课程知识结构及可核对的学习目标", skills: ["research", "writing"], evidence: "生成材料错在哪里，你如何以原资料纠正？", output: "课程来源集、目标表与内容评测样例" }, { name: "系统与评测", task: "实现画像更新、角色协作和失败处理", skills: ["programming", "data-analysis"], evidence: "怎样证实五类资源都与该学生当前需求有关？", output: "可运行系统与含失败样例的评测记录" }],
    gain: "能积累需求分析、工程实现和内容评测证据；模型生成流畅不证明学习效果，也不保证赛果。",
    entry: "需有基础编程和课程资料整理能力，可先在一个小知识点验证生成与引用。", completion: "难点是持续更新画像、资源事实正确和多角色协作可复查，不能把五次调用包装成已验证学习提升。",
    investment: "编辑建议四周每周5小时完成一门课程局部原型；先核对指定讯飞AI辅助工具的可用性、授权及费用；完整课资料、模型费用和正式赛期投入需另估。",
    fit: ["喜欢教育问题与软件工程交叉", "愿意保留生成错误并修正"], avoid: ["只想套通用聊天页面", "没有可合法使用的课程资料也不愿整理"],
    trial: { action: "选一个课程章节，用两种学生对话生成有来源的解释与练习，记录画像变化与一条错误。", output: "两份画像、资源对照和错误修正记录", check: "说清哪句对话改变了哪个字段，哪条原资料支持生成答案。", reflection: "你愿意花时间核内容，还是只喜欢搭界面？" },
    remaining: ["训练体验不是正式参赛作品；当届报名已结束", "开发中其它AI辅助工具须选科大讯飞相关工具，智能体框架不限制；不能把框架不限理解为所有AI工具不限"],
    deepCase: authoredDeepCase({ seriesId: "china-software-cup", task: "2026 A3：以一门完整高校专业课程知识集为输入，构建六维以上对话画像，由多智能体生成五类以上个性化资源并规划推送路径。", title: "真实题拆解：从画像变化到可复核的资源生成", sourceIds: ["softcup-c2-a3", "softcup-c2-notice"], boundary: "已读官方A3完整正文及大赛通知。以下为编辑实施路线，非官方标准答案；四周缩小原型不声称满足完整课程交付或证明学习提升。", steps: ["先核对开发中其他AI辅助工具均为科大讯飞相关工具并保留清单；智能体框架不限不代表AI辅助工具不限。列出完整课程知识边界、来源使用许可与学习目标；把六维画像映射到可由对话观察的证据，学生更正应覆盖旧值。", "先实现一段对话到画像、一个知识点到有来源解释的最小流程，设置资料不足和相互矛盾时的停止或追问。", "定义生成、校验、规划等角色输入输出，逐项验证五类资源的质量和学生适配；记录引用错误与角色之间信息丢失，而非只展示角色名称。", "按35/45/10/10组织演示证据：需求与创新对照、核心功能测试、运行文档和七分钟以内视频；辅导与效果评估在核心闭环可靠后再加。"], questions: ["学生纠正画像后哪些旧资源应重新生成？", "五种输出格式是否真的有不同学习用途？", "课程资料无答案时系统会不会生成肯定结论？"], rubrics: [["创新价值与实用性35%", "将真实需求、已有方案比较与原型测试反馈对应起来，不捏造学习提升数据。"], ["功能实现及技术要求45%", "逐项证明六维画像、五类资源、路径规划、防幻觉与运行稳定性。"], ["文档10%及演示10%", "给出可复现部署、开源与AI声明，用限时视频展示一条完整且包含纠错的流程。"]], roles: [{ role: "课程与需求研究", steps: ["整理来源", "建立目标", "人工核对输出"], contributionProof: "课程目录、错误样本和修订记录" }, { role: "工程与验证", steps: ["设计角色合同", "实现生成校验", "复测失败"], contributionProof: "版本代码、测试输入与输出差异" }], weeks: [["选定课程局部及用户问题", "所有输入材料来源清楚"], ["实现画像与一种资源闭环", "更正可传播且无据答案会停止"], ["扩展角色和资源类型", "每种类型有独立质量检查"], ["整理演示与完整课差距", "如实列出尚未满足的正式要求"]], exits: ["没有课程来源许可时换公开合法资料", "无法解释生成答案依据时暂停新增功能先修内容验证"] })
  },
  {
    seriesId: "service-outsourcing-innovation", name: "中国大学生服务外包创新创业大赛", organizer: "中国大学生服务外包创新创业大赛组委会", aliases: ["服创大赛"], authorAgentId: "/root/continue_catalog", editionId: "2026-17", edition: "2026第十七届A11（历史）", groupId: "college-and-recent-graduates", group: "高校学生及符合毕业年份的毕业生", scopeId: "china-a11-2026", scope: "2026企业命题A11篮球持球人ReID初赛；不套用B类学校名额", trackId: "a11-basketball-reid", trackName: "篮球持球人身份重识别", taskFamily: "software-algorithms", subjectDomains: ["engineering", "science"], origin: "legacy_135", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026初赛和决赛阶段已过去，仅作历史任务与学习路线。",
    sources: [source("fwwb-c2-handbooks", "https://www.fwwb.org.cn/attached/file/20260304/20260304135453_573.zip", "第十七届服创参赛手册及A类赛题手册", "大赛组委会", "2026 A类资格、交付与初赛评分", "ZIP内01参赛手册PDF第12、28—30、37页；03赛题手册第176页", "2026-03-04"), source("fwwb-c2-a11", "https://www.fwwb.org.cn/topic/show/a00d22f4-b2c3-4456-828a-b3dc18661b0b", "A11篮球持球人身份重识别算法开发", "大赛组委会／球秀科技", "2026 A11完整任务与技术指标", "问题、任务、提交、参考信息与评分指向全文", "2026-02-12")],
    verified: {
      eligibility: { text: "全日制高校在籍学生含2026应届本专科及研究生，或2021年后毕业且毕业不超过五年的高校毕业生；可跨校，每队至多五人、导师至多两人，每人仅一队且每队选一个类别。", source: 0 },
      track: { text: "A11用篮球持球人裁剪图作Query，在Gallery中找回同一球员；不依赖连续轨迹，重点处理相同球衣、遮挡与运动模糊；深度学习框架限定PyTorch。", source: 1 },
      participation: { text: "团队在官网注册、添加成员和导师、选A类具体一题并经审核；A类不受B类每校两队限制。", source: 0 },
      deliverables: { text: "提交概要、PPT、详细技术方案、演示视频和训练好的模型；通用要求PPT至多20页/50M，方案PDF20M内，MP4视频五分钟/100MB内。", source: [0, 1] },
      rubric: { text: "手册将A类初赛统一评分表明确标为“仅供参考”：项目创意20、实施方案30、技术实现与交付30、项目展示20；A11另列mAP至少91.5%、Rank-1至少94%，参考4090上特征提取40ms内、单Query本地匹配30ms内。技术指标不是全部评分；参考表不得声称为最终确定分值，须以当届最终适用规则核对。", source: [0, 1] }
    },
    eligibilityRules: [{ id: "fwwb-status", field: "priorQualification", operator: "requires_confirmation", value: "在籍全日制高校学生或2021年后毕业且不超过五年", factIds: ["service-outsourcing-innovation:v2:eligibility"], note: "包含毕业生分支，不能简单把不在校判不符合。" }, { id: "fwwb-team", field: "teamSize", operator: "max", value: 5, factIds: ["service-outsourcing-innovation:v2:eligibility"], note: "导师另计至多两人。" }],
    task: "建立可复查的图像检索模型，分离队服颜色捷径与身份特征，并同时验证准确率和推理时延。",
    roles: [{ name: "模型与数据", task: "整理授权数据、划分身份并分析遮挡误检", skills: ["programming", "data-analysis"], evidence: "你的提升是否只来自同一人的相似图片泄漏？", output: "划分说明、模型和失败案例" }, { name: "工程与复现", task: "复现实验、计时和演示检索", skills: ["programming", "writing"], evidence: "计时包含哪些步骤，换设备后如何报告？", output: "运行环境、计时脚本和技术报告" }],
    gain: "可形成视觉检索、实验设计与工程复现证据；离线准确率不等于现实部署有效或获奖。",
    entry: "需Python、PyTorch与基础机器学习能力，可先读Query/Gallery与两种指标含义。", completion: "难点是身份泄漏、相似队服干扰和性能测量可信，不是只更换一个大模型。",
    investment: "编辑建议四周每周5小时先完成小样本基线；官方数据可用性、训练算力、参赛费及旅行净支出需另核。",
    fit: ["喜欢视觉数据与可复现实验", "愿意分析失败而不只报最佳分数"], avoid: ["只会调用通用图像接口且不愿学习评估", "没有合法数据或计算资源仍想承诺指标"],
    trial: { action: "在获授权的小型图片集合中构造Query/Gallery，手算一个查询的Rank-1与平均精度，找一组相同队服误检。", output: "检索列表、手算过程和错误解释", check: "同一身份不跨训练与独立测试泄漏，明确练习数据不等于企业评测数据。", reflection: "你喜欢分析视觉错误还是搭建检索交互？" },
    remaining: ["企业网盘数据未读取，不能声称已跑官方基线或达到指标", "费用与算力获取未核清；题目限定PyTorch，允许公开外部训练数据但必须声明来源并用企业测试集终评"],
    deepCase: authoredDeepCase({ seriesId: "service-outsourcing-innovation", missing: ["两份官方手册20/30/30/20均标仅供参考；A11技术阈值不是最终正式评分，适用评分原件仍缺。"], task: "2026 A11：仅凭跨时刻外观，在相同球衣、遮挡和模糊条件下，从Gallery检索Query持球人的图像ID，兼顾mAP、Rank-1及参考硬件时延。", title: "真实题拆解：防止颜色捷径与评测泄漏", sourceIds: ["fwwb-c2-a11", "fwwb-c2-handbooks"], boundary: "已读完整官方题面、ZIP内资格交付和标明仅供参考的统一评分表。未下载企业图片或运行基线；以下为编辑实验路线，不声称达到官方阈值，公开题目完整性与训练数据可得性分开记录。", steps: ["先写Query、Gallery、身份划分和数据许可清单，分清mAP与Rank-1，不把同一球员相邻近重复帧拆到训练与独立验证中。", "在PyTorch复现一个可运行基线，固定种子与配置；按相似队服、遮挡、模糊和环境分别列失败例，不只报合并平均值。", "每次只改一个特征或训练策略，与同样数据和配置的基线比较；允许外部训练数据时记录来源，最终企业测试集规则不能被自选测试替代。", "分别测特征提取与本地匹配时延，写明批大小、预热、设备和计时范围；暂按参考表创意20、方案30、实现30、展示20组织训练报告，不声称最终评分已确定，未达标项如实披露。"], questions: ["只靠队服颜色为何能有看似很高的结果？", "Rank-1提高而mAP下降说明什么？", "换用不同显卡测得的毫秒数能否宣称满足参考环境指标？"], rubrics: [["参考表：项目创意20与实施方案30", "以实际失败类型说明改动动机，排定资源与阶段目标。"], ["参考表：技术实现与交付30", "同时报告检索指标、计时条件和复现文件，区分目标与实测。"], ["参考表：项目展示20", "五分钟内演示一次查询及失败例，文档让评委能追溯模型和数据。"]], roles: [{ role: "数据与实验", steps: ["划分身份", "复现基线", "分析困难例"], contributionProof: "许可、划分清单和对照实验" }, { role: "工程与报告", steps: ["实现检索", "测量时延", "打包模型"], contributionProof: "运行说明、计时日志和演示版本" }], weeks: [["理解指标与合法数据边界", "手算例与程序评估相符"], ["固定训练验证划分并建立行人重识别基线", "可重复并披露硬件条件"], ["单一改动及失败分析", "同条件对照且无数据泄漏"], ["整理可运行交付并解释不同球员遮挡情形的误差", "模型、文档和视频一致，未测部分明确"]], exits: ["无法获得授权数据时停在小型公开练习并不声称完成企业任务", "训练成本不可承担时换低算力检索学习路径"] })
  },
  {
    seriesId: "china-college-computer-design", name: "中国大学生计算机设计大赛", organizer: "中国大学生计算机设计大赛组织委员会", aliases: ["4C"], authorAgentId: "/root/continue_catalog", editionId: "2026-19", edition: "2026智能工业视觉专项（历史）", groupId: "full-time-undergraduate", group: "普通高校全日制本科生", scopeId: "china-ai-industrial-2026", scope: "2026人工智能挑战赛智能工业视觉国赛规则，不代表省赛评分", trackId: "ai-industrial-vision", trackName: "智能工业视觉检测专项挑战赛", taskFamily: "software-algorithms", subjectDomains: ["engineering", "science"], origin: "legacy_135", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026第19届赛季已过去，作为历史专项任务；国赛需省赛上推。",
    sources: [source("4c-c2-national", "https://jsjds.blcu.edu.cn/info/1042/2124.htm", "4C2026预通知", "全国组委会", "2026本科资格与省赛上推路径", "正文参赛对象、三级赛制与人工智能类别", "2026-01-01"), { ...source("4c-c2-industrial", "https://jsjds.exelab.cc/docs/C02v20260225.01.pdf", "智能工业视觉检测专项挑战赛V20260225.01", "大赛人工智能挑战赛组织方", "2026专项公开任务、设备、现场测试与排名", "完整PDF第1—11页；核心任务和评分第1—5页", "2026-02-25"), authority: "official_host" }],
    verified: {
      eligibility: { text: "2026在籍普通高校本科生可参加，含港澳台和来华留学生；国赛只接受省级赛上推的普通高校全日制本科作品。", source: 0 },
      track: { text: "工业视觉规定任务含分类、计数、缺陷、尺寸、编号识别，另可做自备扩展场景；指定VisionMaster4.3.0和相机控制器等设备不可更换改装。", source: 1 },
      participation: { text: "校赛、省赛、国赛三级路径；专项省赛规则可另定，国赛现场测试与演示答辩中导师不能场外指导。", source: [0, 1] },
      deliverables: { text: "国赛现场识别25件产品五类各五件，保存结果与耗时标注图片；扩展任务预交视频，现场另作演示答辩。每件多图按最差计，覆盖图片不得分。", source: 1 },
      rubric: { text: "现场先比检测得分、同分比平均耗时；最终排名按现场测试排名65%加演示答辩排名35%，是名次加权而非原始分数加权。计数评分一行存在缺陷措辞，需向官方确认。", source: 1 },
      investment: { text: "支持方只提供一定量设备借用与现场公用设备，可能轮换；扩展硬件/产品/数据自备，不能保证个人免费获得设备。", source: 1 }
    },
    eligibilityRules: [{ id: "4c-c2-degree", field: "degree", operator: "eq", value: "undergraduate", factIds: ["china-college-computer-design:v2:eligibility"], note: "国赛普通高校全日制本科。" }, { id: "4c-c2-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["china-college-computer-design:v2:eligibility"], note: "官方国赛资格。" }, { id: "4c-c2-qualification", field: "priorQualification", operator: "requires_confirmation", value: "省级赛上推资格", factIds: ["china-college-computer-design:v2:eligibility"], note: "不是个人直报国赛。" }],
    task: "按2026年国赛工业视觉专项任务完成产品分类、目标计数、缺陷检测、尺寸检测和编号识别。",
    roles: [{ name: "视觉流程", task: "比较分类、测量或OCR方法并分析误差", skills: ["programming", "data-analysis"], evidence: "换光照或零件位置后，哪一步最先失效？", output: "流程配置与误差对照" }, { name: "系统与证据", task: "检查采集、结果存储、计时与现场操作", skills: ["engineering", "presentation"], evidence: "一个正确结果为什么可能因存档方式失分？", output: "配置清单、结果图及限时演示" }],
    gain: "可积累视觉工程、环境适应和实验记录能力；软件模拟不等于满足指定硬件赛项。",
    entry: "可以先用合法示例图学习一种识别任务；正式训练需核实指定平台和设备可用。", completion: "难点包含物理采集变化、保存证据、切换耗时及答辩解释，不能只用离线准确率评估。",
    investment: "编辑建议四周每周4小时先练一项任务；指定硬件借用、耗材、现场旅行与总费用需要学校确认。",
    fit: ["愿意反复调试采集环境", "喜欢把算法接到实际设备"], avoid: ["无法接触指定平台却希望直接完成正式任务", "只愿用固定图片展示最好结果"],
    trial: { action: "对一组自有编号照片做OCR试验，逐渐改变光照和角度，保存每张识别结果与耗时。", output: "包含失败例的对照表与标注图", check: "结果不覆盖、时间测量口径一致，明确普通电脑试验不是正式指定设备成绩。", reflection: "你能接受调环境和记录错误占用多数时间吗？" },
    remaining: ["未读赛前另发的具体零件尺寸标准和训练数据，不能编造现场物品值", "团队人数与费用待适用完整规程核定；计数项评分文字歧义未消除，须限制该细项结论"],
    deepCase: authoredDeepCase({ seriesId: "china-college-computer-design", task: "2026智能工业视觉检测公开专项：十分钟内处理25件产品，五类各五件，将检测结果和耗时保存成证据图，并进行扩展场景演示答辩。", title: "真实公开专项拆解：从检测到可判分证据", sourceIds: ["4c-c2-industrial", "4c-c2-national"], boundary: "已读完整11页官方公开题与全国预通知。真实现场零件及尺寸阈值未取得，以下是针对公开任务的编辑准备路线；不把自制练习图片冒充赛题数据。计数评分措辞歧义单独保留；不能宣称该评分细项已核清，不据此计算精确分数或预计名次。", steps: ["建立指定平台设备核对清单，逐一列出五类任务的输入、输出、现场才公布的参数；先确认借用和使用权限。", "先实现一种任务的采集—处理—结果标注—唯一文件存储闭环，使用不同照明和摆放检查失败，把耗时口径固定。", "再把五类流程串联做25件的限时模拟，切换也计时，每件保留一张且不覆盖；对目标计数的评分歧义向官方核对，勿自行决定规则。", "扩展任务用自备合法数据与设备录视频，答辩解释失败边界和成本；排名分析采用65/35名次加权，不误算成总分权重。"], questions: ["识别正确但结果图覆盖，会造成什么后果？", "测试光照不同，怎样区分采集问题和模型问题？", "为什么提高原始分数的幅度不等于最终排名变化幅度？"], rubrics: [["现场正确性与同分耗时", "保留可判读结果图及一致计时，未取得的尺寸标准留空。"], ["现场排名65%与答辩排名35%", "分别准备限时运行和可解释演示，严格使用名次合成。"]], roles: [{ role: "视觉算法", steps: ["选择一项基线", "分析光照误差", "扩展任务"], contributionProof: "配置、失败对照与参数变化记录" }, { role: "集成和现场流程", steps: ["核对硬件", "实现唯一存档", "限时模拟"], contributionProof: "设备清单、结果图与演示排练记录" }], weeks: [["核对设备与公开规则", "区分已知任务和待公布参数"], ["一种检测的留证闭环", "所有结果可复查且不覆盖"], ["多场景与流程切换", "失败原因有对照测试支持"], ["按官方工业视觉任务进行限时演示和答辩模拟", "如实列出与正式设备/数据的差距"]], exits: ["无法获得指定平台时转为通用视觉学习不承诺参赛完成", "评分歧义未解释前不据此计算预计名次"], missing: [] })
  }
];
