import { readSource, type ResearchedContent } from "./research-types";

/** Written after opening the identified official bodies on 2026-11-05; not bulk-generated from names. */
export const researchBatch01: ResearchedContent[] = [
  {
    seriesId: "apple-swift-student-challenge", authorAgentId: "/root/continue_catalog", name: "Apple Swift Student Challenge", organizer: "Apple Inc.", aliases: ["Swift学生挑战赛"],
    editionId: "2026", edition: "2026（已结束；用于作品准备）", groupId: "individual-student", group: "满足地区年龄和在读条件的个人学生", scopeId: "global-2026", scope: "Swift Student Challenge 2026条款；不推定2027资格与窗口",
    trackId: "app-playground", trackName: "个人离线App Playground", taskFamily: "software-algorithms", subjectDomains: ["engineering", "arts"], origin: "verified_expansion", factStatus: "historical",
    registrationStatus: "closed", registrationNote: "2026条款截止于2026-02-28 23:59 PST，已过期；这里只提供历史规则下的作品练习路线。",
    eligibilityFacts: [{"idSuffix": "individual", "text": "作品须由报名者本人独立完成或独立修改模板；不接受小组作品。", "sourceIds": ["swift-2026-policy"]}],
    eligibilityRules: [
      { id: "swift-personal", field: "teamSize", operator: "max", value: 1, factIds: ["apple-swift-student-challenge:v2:eligibility.individual"], note: "个人作品，团队共同创作不适用。" },
      { id: "swift-not-fulltime-professional", field: "professionalDeveloper", operator: "eq", value: false, factIds: ["apple-swift-student-challenge:v2:eligibility"], note: "指全职专业开发工作；业余课程开发不等同该排除条件。" },
      { id: "swift-student-exceptions", field: "enrolled", operator: "requires_confirmation", value: "在读、90日内毕业及其他列明教育身份；年龄按地区", factIds: ["apple-swift-student-challenge:v2:eligibility"], note: "规则存在多种教育身份分支，不能只用单个在读布尔值排除。" }
    ],
    sources: [
      readSource("swift-2026-policy", "https://developer.apple.com/swift-student-challenge/policy/", "Swift Student Challenge 2026 Terms and Conditions", "Apple Developer", "2026个人挑战赛正式条款", "Application Eligibility、Submission Requirements、Judging；正文131—180行"),
      readSource("swift-playground-requirements", "https://developer.apple.com/swift-student-challenge/eligibility/", "Eligibility and requirements", "Apple Developer", "2026-11-05读取的资格与作品要求页；与2026正式条款共同使用", "Building your app playground；正文130—139行"),
      { ...readSource("swift-accessibility-2025-full", "https://github.com/phnagy/ssc2025/tree/960b72301329ff8dd5f67801eca8d9a8240fabe7", "Accessibility Escape：作者完整2025公开项目", "Philipp Nagy（项目作者）", "作者标记为Swift Student Challenge 2025的完整源代码/本地素材；不认证获奖或2026合规", "锁定commit的README、Package.swift、五个Level视图、Model/Level、LevelViewModifier、指南及三张作者截图", "2025"), authority: "other", evidenceArtifact: "artifacts/continuation-20261105/content/source-rechecks-batch05/reading-log.json" }
    ],
    verified: {
      eligibility: { text: "2026规则要求不从事全职开发工作并满足列明学生身份；中国大陆通常至少14岁。需注册Apple开发者身份，Apple员工、实习生及列明关联人员不符资格；最终由Apple核验。", source: 0 },
      track: { text: "每人提交一个个人创作的App Playground，作品须可离线评审。团队作品不参与评审，第三方素材须遵守许可并说明用途。Apple作品要求页还说明，交互作品应在三分钟内可体验。", source: [0, 1] },
      participation: { text: "通过官方申请入口填表并上传作品和有效在读证明；只接受截止前在线提交，英文问答须本人撰写。", source: 0 },
      deliverables: { text: "提交不超过25MB的ZIP，包含.swiftpm及离线资源；使用Swift Playground 4.6或Xcode 26及更新版本，内容为英文。作品须可离线评审。", source: 0 },
      rubric: { text: "评审依据技术完成度、创意和申请表书面回答；评分不公开，也不提供个人作品反馈。AI辅助须披露，不能替代本人技术理解。", source: 0 }
    },
    task: "把一个小问题做成可离线体验的小型交互程序，用运行效果和自己的文字解释技术与设计取舍。",
    roles: [{ name: "独立交互开发", task: "自己实现输入、状态变化和反馈，处理离线资源与错误路径", skills: ["programming", "design"], evidence: "你能从输入开始讲清状态怎样变化，并当场修改一个反馈逻辑吗？", output: "个人代码、状态图、离线测试表与设计迭代" }],
    gain: "完成后可保留小型交互作品及本人实现记录；申请条款不保证反馈、获奖或工作机会，展示前仍应清理第三方授权与个人数据。",
    entry: "先能独立修改一个Swift示例并说明变量和事件；没有Apple开发设备时先画交互流程，不把原型当可提交程序。",
    completion: "主要差距是离线可运行、三分钟体验完整、英文解释清楚，以及每部分都能证明由本人创作。",
    investment: "编辑建议用四周、每周4—6小时试做一条交互流程；Mac或iPad及可运行工具是资源条件，未持有设备时先核对借用方案；开发者注册相关支出、设备成本与个人总费用仍需逐项确认。",
    fit: ["希望独立做一个能演示的小软件作品", "愿意把功能缩小并反复测试交互"], avoid: ["只能提交多人共同开发的成品", "不愿说明本人代码和第三方内容的边界"],
    trial: { action: "选一个可离线表达的小知识点，画三屏流程并完成一个按钮引起状态变化的交互；关闭网络后试用。", output: "三屏流程、一次离线演示及失败记录", check: "另一人在三分钟内理解目标并完成操作，作者能解释触发一次状态更新的代码。", reflection: "你更喜欢交互解释、写逻辑还是排查运行问题？" },
    remaining: ["2027条款、报名时间与当届工具版本未采用；此记录不证明下一届可报", "设备实际可借用性、用户个人年龄及学校证明仍待确认"],
    deepCase: {
      status: "draft", representativeTask: "完整公开作品Accessibility Escape：通过深色模式、对比度、文字大小、减弱动态和VoiceOver五个解谜关卡学习可访问性；以VoiceOver关卡追踪输入到完成反馈。",
      workedExample: { title: "作者完整作品拆解：海岸图片、苹果标签与通关条件的语义冲突", origin: "published_work", sourceIds: ["swift-accessibility-2025-full", "swift-2026-policy", "swift-playground-requirements"], sourceBoundary: "已取得锁定commit的完整SwiftPM工程、本地素材与三张作者截图，并阅读入口、五关逻辑、指南和共享完成状态。作者README标为2025挑战赛作品；没有借此认证获奖、原始提交版本或2026合规。2026正式评分作为明确分年的学习比较，不倒填2025个人分数。本轮为静态源码/图像核读，未在iOS运行；Package声明iOS16，而主类型标iOS18，部署兼容性仍需真实设备验证。无明确开源许可，公开可读不等于允许复制参赛。", steps: ["从AccessibilityEscape入口到Model.levels，列出五个关卡及其对应系统设置。LevelsView在辅助功能大字号下改为单列，不能仅凭这处适配断言整个作品可访问。", "VoiceOver-1资源目录的Contents.json实际绑定一张海岸航拍JPEG，画面是海水、礁石和沿岸植被，并非苹果照片。视图在该图上覆盖模糊材质，却为外层容器设置Apples hanging from a tree标签；装饰条隐藏于可访问树。输入框问题要求辨认水果，代码仅在text.lowercased()等于apple时设置solved。把真实素材、辅助标签、问题和答案逐项对照：本版本存在可直接核验的语义不一致，不能描述成苹果图被正确读懂的成功案例；标签可能误导辅助技术用户。列出apple、APPLE、apples和空白输入的预期分支，区分静态代码预测与实际VoiceOver播报、用户体验测试。", "追踪solved进入LevelViewModifier，再到Model.solveLevel及Level.solve。共享onChange没有检查solved是否为true，是需要实机复现的状态风险：不能把阅读源码当无缺陷认证。对比Motion关卡读取reduceMotion后停止运动并允许Escape，说明系统偏好怎样改变交互。", "阅读GuideVoiceOverView中开关标签、语音讲解和代码示例，比较“能完成关卡”与“理解标签作用”两个目标；作者截图证明其展示内容，不证明用户学习效果。为自己重新设计的离线小任务写状态表、失败恢复和许可清单，再与2026技术/创意/书面说明要求作学习映射。"], reviewQuestions: ["海岸图片为何被标为苹果？标签、视觉素材和通关答案怎样核对，才能避免误导辅助技术用户？", "大小写与复数输入分别进入什么分支；完成状态变化是否真的受到true保护？", "代码、作者截图、实机运行和用户理解测试各自能证明什么？"] },
      rubricMapping: [{ criterion: "技术完成度", evidence: "2026准则的学习比较：以2025公开工程建立离线资源、VoiceOver输入分支及完成状态检查表；仍须实机验证，不给原作打分。", official: true, factIds: ["apple-swift-student-challenge:v2:rubric"] }, { criterion: "创意与书面回答", evidence: "2026准则的学习比较：解释原作以系统设置解谜的设计，再独立设计不同任务并写本人英文说明；不复制无明确许可的源码或素材。", official: true, factIds: ["apple-swift-student-challenge:v2:rubric"] }],
      rolePaths: [{ role: "独立开发者", steps: ["画清输入状态输出", "实现并调试单一功能", "说明原创内容与所用素材边界"], contributionProof: "代码提交记录与独立解释演示" }],
      fourWeekPlan: [{ week: 1, action: "定义使用者、一个问题和三屏交互", completionCheck: "纸面试用者能说出操作目标" }, { week: 2, action: "独立完成最小离线功能", completionCheck: "断网仍可完成核心操作" }, { week: 3, action: "测试异常输入并改善反馈", completionCheck: "保留至少两项失败与修复记录" }, { week: 4, action: "整理英文解释、许可清单和打包检查", completionCheck: "本人可从解压到演示完整复现" }],
      exitConditions: ["暂时没有合适设备则先做流程和基础语言练习，不承诺能直接提交", "无法解释主要代码时缩小功能并重新独立实现"], missingForPublication: []
    }
  },
  {
    seriesId: "geographical-science-innovation", name: "全国大学生地理科技创新大赛", organizer: "中国地理学会、中山大学地理科学与规划学院", aliases: ["中国高校地理科学展示大赛", "全国大学生地理科学展示大赛"],
    editionId: "2026-9", edition: "2026第九届（历史初审资料）", groupId: "human-geography", group: "地理专业院系组织的人文地理组", scopeId: "china-preliminary", scope: "第九届人文地理组作品初审；决赛具体细则另行通知", trackId: "human-geography", trackName: "人文地理组", taskFamily: "investigation", subjectDomains: ["science", "management"], origin: "verified_expansion", factStatus: "historical",
    registrationStatus: "closed", registrationNote: "2026院系注册于4月30日截止、作品5月提交；不推定后续届次开放。",
    eligibilityRules: [
      { id: "geography-undergraduate", field: "degree", operator: "in", value: ["undergraduate"], factIds: ["geographical-science-innovation:v2:eligibility"], note: "通知主题明确本科生范围。" },
      { id: "geography-department", field: "institution", operator: "requires_confirmation", value: "开设地理专业的院系统一报名及本组名额", factIds: ["geographical-science-innovation:v2:eligibility"], note: "不接受个人报名，尚无院系确认不能显示资格已满足。" }
    ],
    sources: [readSource("geography-2026-notice", "https://www.gsc.org.cn/gsc/xueshuDetail.html?contentId=2318&id=56", "“新蚁族杯”第九届全国大学生地理科技创新大赛通知", "中国地理学会", "2026第九届初审及决赛组织通知；各院系报名", "正文主题、赛程赛制、作品审查和参赛费用，54—123行", "2026-03-31")],
    verified: {
      eligibility: { text: "本届面向地理科学类本科生，以开设地理专业的高校院系为单位报名，不接受个人报名；具体成员要求仍须核对院系和参赛确认表。", source: 0 },
      track: { text: "第九届更名为地理科技创新大赛，分自然地理（含综合地理）与人文地理组；本记录限定人文地理初审。", source: 0 },
      participation: { text: "院系先注册，团队再提交作品及确认表；每单位每组最多两支队伍，初审后选拔现场PPT展示和答辩。", source: 0 },
      deliverables: { text: "围绕地理分异与因地制宜提交原创科学作品：MP4不超过8分钟、50MB，内容不得出现个人、单位及资助信息。", source: 0 },
      rubric: { text: "函评关注选题、原创性、逻辑、科学过程、结论、课件和配音规范；没有公布本页各项权重，决赛细则另发。", source: 0 },
      investment: { text: "作品初审费每件300元；决赛另收注册费，金额待通知，不能认定个人总支出仅300元。", source: 0 }
    },
    task: "用空间差异解释一个具体地方问题，把调查、地图和论证做成短视频，让观众看懂为何同一种措施不适合所有地区。",
    roles: [{ name: "空间调查与论证", task: "比较两个地点的条件，用同口径资料解释差异而非仅展示照片", skills: ["fieldwork", "research", "data-analysis"], evidence: "你比较两个地区时控制了哪些不同口径，结论可能被什么反例推翻？", output: "资料来源表、空间比较图和证据链" }, { name: "科学展示", task: "把地理问题、方法与局限组织为匿名短视频", skills: ["presentation", "writing"], evidence: "能否指出哪一幅图真正支撑结论，删去后论证会缺什么？", output: "脚本、可追溯图表和视频修订记录" }],
    gain: "完成后可积累地方问题研究、资料比较和科学表达的个人证据；只有实际负责的调查与图表可以写入作品集，参赛名额与奖项另有条件。",
    entry: "能阅读地图、比较资料来源即可先体验；地理兴趣不等于已有院系参赛名额。", completion: "难在把地点差异转成可检验解释，统一数据口径，并在八分钟内讲清方法与局限。",
    investment: "编辑建议先用开放资料做桌面比较，四周每周4—6小时；正式调查、视频制作、团队分摊及决赛差旅另算，先确认院系名额。",
    fit: ["愿意比较地方情境并追查数据出处", "希望把研究写作转成可解释的地图与视频"], avoid: ["只想剪辑风景而不检验论点", "未确认院系资格却希望个人直接报名"],
    trial: { action: "选两处熟悉地点，比较同一公共服务的空间分布，写出一种解释及一种替代解释。", output: "一张比较图、三条资料出处和两分钟讲解", check: "听众能复述差异与证据，并指出尚不能下结论的部分。", reflection: "你更喜欢找资料、做空间图，还是向人解释原因？" },
    remaining: ["完整确认表中的成员人数和导师限制尚未采用；需由院系核验", "现场决赛评分与费用不在本记录的初审范围内"],
    deepCase: {
      status: "draft", representativeTask: "2026官方主题：地理分异与因地制宜；人文地理组以原创科学视频参加初审。",
      workedExample: { title: "主题拆解：从地点差异到因地制宜的解释", origin: "official_task", sourceIds: ["geography-2026-notice"], sourceBoundary: "这是公开主题与初审标准的编辑拆解，不是已获奖案例；具体比较地点由学习者自行选择。", steps: ["先将‘地区不一样’改写成一个具体问题，明确地点、时间和要比较的指标。", "收集同口径地图或公开统计，记录缺失信息；不把相关性直接写成政策因果效果。", "提出至少两种解释，找反例检验选题是否真正体现地理分异。", "组织问题—证据—解释—局限的视频脚本，匿名检查后测试观看者能否复述结论。"], reviewQuestions: ["两个地点的数据是否同年同口径？", "哪一种观察会让你改变结论？", "展示是否泄露了单位或作者身份？"] },
      rubricMapping: [{ criterion: "选题精准、逻辑严谨、过程科学、结论合理", evidence: "编辑检查：问题边界、同口径资料表、替代解释及结论限制。", official: true, factIds: ["geographical-science-innovation:v2:rubric"] }, { criterion: "课件与画外音表达", evidence: "编辑检查：匿名版视频与观众复述结果，而非单看视觉包装。", official: true, factIds: ["geographical-science-innovation:v2:rubric"] }],
      rolePaths: [{ role: "空间调查者", steps: ["确定比较单位", "核对资料口径", "提出并检验替代解释"], contributionProof: "资料溯源表与本人分析图" }, { role: "科学表达者", steps: ["写证据驱动脚本", "制作匿名图示", "按观众误解修订"], contributionProof: "脚本版本及修改理由" }],
      fourWeekPlan: [{ week: 1, action: "确定两个地点和一个可比较指标", completionCheck: "列出三条能访问的资料与研究边界" }, { week: 2, action: "统一口径并画比较图", completionCheck: "图中数值可追溯到原始资料" }, { week: 3, action: "检验解释并写短视频脚本", completionCheck: "保留一种未排除的替代解释" }, { week: 4, action: "录制匿名样片并做理解测试", completionCheck: "听众说得出证据、结论及限制" }], exitConditions: ["资料口径无法对齐时换一个更小的问题，不拼接不可比数据", "拿不到院系名额时保留学习作品，不虚报报名资格"], missingForPublication: ["当前仅有官方开放主题或通用交付要求的编辑练习路线，尚未取得足够具体的完整官方题或完整公开作品；不计入严格L3案例"]
    }
  },
  {
    seriesId: "schneider-go-green", name: "Schneider Go Green", organizer: "Schneider Electric", aliases: ["施耐德绿色能源挑战赛"], editionId: "2026", edition: "2026（第一阶段已截止）", groupId: "student-team", group: "18至30岁在读学生团队", scopeId: "global-phase-one", scope: "2026 Energy Tech for Local Impact第一阶段项目提案；不沿用决赛时长", trackId: "energy-proposal", trackName: "社区清洁能源项目提案", taskFamily: "business-practice", subjectDomains: ["engineering", "management", "economics"], origin: "verified_expansion", factStatus: "historical",
    registrationStatus: "closed", registrationNote: "FAQ明确2026注册与初始提案已于8月28日23:59 UTC截止；后续阶段仅限已入围团队。",
    eligibilityRules: [
      { id: "gogreen-age-min", field: "age", operator: "min", value: 18, factIds: ["schneider-go-green:v2:eligibility"], note: "按提交初始申请时年龄。" },
      { id: "gogreen-age-max", field: "age", operator: "max", value: 30, factIds: ["schneider-go-green:v2:eligibility"], note: "按提交初始申请时年龄。" },
      { id: "gogreen-degree", field: "degree", operator: "in", value: ["undergraduate", "graduate"], factIds: ["schneider-go-green:v2:eligibility"], note: "须是当前注册在读的本科或研究生。" },
      { id: "gogreen-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["schneider-go-green:v2:eligibility"], note: "允许全日制和非全日制。" },
      { id: "gogreen-team-min", field: "teamSize", operator: "min", value: 2, factIds: ["schneider-go-green:v2:eligibility"], note: "不是个人正式参赛；可先个人练习。" },
      { id: "gogreen-team-max", field: "teamSize", operator: "max", value: 4, factIds: ["schneider-go-green:v2:eligibility"], note: "团队最多四位符合条件的成员。" },
      { id: "gogreen-country", field: "sameCountryTeam", operator: "eq", value: true, factIds: ["schneider-go-green:v2:eligibility"], note: "以学习所在国家为准，不以国籍代替。" },
      { id: "gogreen-language", field: "language", operator: "requires_confirmation", value: "English", factIds: ["schneider-go-green:v2:eligibility"], note: "需能完成英文提案与交流，不由姓名或专业推断。" }
    ],
    sources: [readSource("gogreen-2026-terms", "https://www.gogreencompetition.com/terms-conditions", "2026 Schneider Go Green Terms & Conditions", "Schneider Electric", "2026第一阶段资格、提交与晋级评审", "II Eligibility、III How to Enter、IV Selection for Phase II；73—220行"), readSource("gogreen-2026-faq", "https://www.gogreencompetition.com/faq", "Schneider Go Green Frequently asked questions", "Schneider Electric", "2026费用、线上形式、初始提案截止与内容", "registration fee、travel、key dates、Phase 1 deliverables；24—68行")],
    verified: {
      eligibility: { text: "18—30岁、在读本科或研究生；2—4名学生组队，成员在同一国家学习，可跨校跨专业；每人只属一队且须能使用英文。", source: 0 },
      track: { text: "2026任务是为资源不足社区提出清洁、可负担的可再生能源方案；本记录只覆盖第一阶段初始提案。", source: 0 },
      participation: { text: "成员先个人注册再组队，在YouNoodle平台用英文提交原创提案；专家从首阶段选出前10队继续深化。", source: 0 },
      deliverables: { text: "第一阶段说明社区能源问题、原创解决思路与环境和社会影响；不得以AI生成内容作为方案基础，参考素材须有使用权。", source: 0 },
      rubric: { text: "第一阶段看创新、技术与经济可行性、环境影响及低收入社区的社会影响；没有采用未公开权重。", source: 0 },
      investment: { text: "FAQ说明免报名费并采用线上参与；这不包含个人设备、调研、验证或其他自愿投入成本。", source: 1 }
    },
    task: "从一个具体社区的用能困难出发，比较技术方案和经营成本，解释谁会受益、谁承担费用以及方案如何维护。",
    roles: [{ name: "社区问题与商业验证", task: "确认真实用能痛点、支付能力和维护者，核算方案的最小收支模型", skills: ["fieldwork", "accounting-finance", "product"], evidence: "你问过谁的需求，哪一项收入或成本是假设，降低付款能力时结果怎样变？", output: "访谈摘要、成本敏感性表和利益相关者图" }, { name: "能源方案验证", task: "计算需求与供给的数量级，检查技术在当地条件下是否可实施", skills: ["research", "data-analysis"], evidence: "能否解释一个能量或功率估算及它依赖的假设？", output: "需求计算、技术比较及失效情境" }],
    gain: "完成提案可形成需求研究、技术比较和财务假设的作品证据；导师与后续展示需晋级，主办方条款不承诺就业或商业合作。",
    entry: "能把一个社区问题说清并做基本成本测算可先练习；新能源兴趣不等于掌握电气施工能力。", completion: "难点是把技术指标、真实支付能力与持续维护连接起来，并避免把估计减排量当实测结果。",
    investment: "编辑建议用四周每周4—6小时做桌面方案与一次非敏感访谈；不要求购买设备，涉及电气安装或现场测试须由具备条件的专业人员另行评估。",
    fit: ["愿意同时检查用户需求、工程假设和经营成本", "希望形成可持续发展方案而非只做口号宣传"], avoid: ["希望仅凭想法获得保证实习", "准备开展没有专业支持的电气施工"],
    trial: { action: "选一个熟悉场所的用能问题，列现状与两种改进方案，估算每天能耗和维护成本。", output: "一页需求、两案比较及三条未证实假设", check: "能说明在何种使用量或价格下推荐方案会改变。", reflection: "你更喜欢理解社区、算收支还是比较技术？" },
    remaining: ["FAQ与条款对决赛展示时长不一致，因此本记录不提供决赛时长结论", "下一届是否延续、成员实际年龄学籍和个人总成本需重新核验"],
    deepCase: {
      status: "draft", representativeTask: "官方2026任务：为真实社区提供可负担、可持续的清洁能源方案，论证环境与社会影响。",
      workedExample: { title: "官方首阶段任务拆解：社区用能方案的四项论证", origin: "official_task", sourceIds: ["gogreen-2026-terms"], sourceBoundary: "以下是首阶段官方目标与评审维度的编辑研究路线；没有假设某社区已有实测节能或商业成果。", steps: ["先界定受益群体和具体用能困难，记录现状、可访谈对象及不能获取的信息。", "比较至少两种技术路线，用相同用能量和价格假设估算建设与维护投入。", "对收入、替换周期与使用量做敏感性分析，找出项目失去可负担性的条件。", "分开陈述可测量的环境指标和需要进一步验证的社会影响，形成原创英文提案。"], reviewQuestions: ["支付者与受益者是否同一群人？", "设备失效后谁负责维修和费用？", "哪一项影响只是估算而没有实测？"] },
      rubricMapping: [{ criterion: "创新及技术经济可行性", evidence: "编辑检查：基线比较、关键计算和价格敏感性分析。", official: true, factIds: ["schneider-go-green:v2:rubric"] }, { criterion: "环境与社会影响", evidence: "编辑检查：指标定义、受益群体、负面影响与验证方法。", official: true, factIds: ["schneider-go-green:v2:rubric"] }],
      rolePaths: [{ role: "经营验证", steps: ["确认支付者", "拆解长期成本", "检验最脆弱的财务假设"], contributionProof: "本人访谈和成本模型版本" }, { role: "技术分析", steps: ["估算用能", "比较两种技术", "列出不可用场景"], contributionProof: "带单位的计算表和来源索引" }],
      fourWeekPlan: [{ week: 1, action: "选择社区情境并定义用能问题", completionCheck: "区分已知需求、转述和待访谈假设" }, { week: 2, action: "比较技术与完整成本", completionCheck: "两方案使用同一组需求假设" }, { week: 3, action: "分析环境和社会影响的边界", completionCheck: "至少一个指标有可行验证方法" }, { week: 4, action: "形成英文提案并接受质疑", completionCheck: "能回答谁付费、谁维护及何时不划算" }], exitConditions: ["无法取得社区需求证据时回到桌面学习，不伪造访谈或影响数据", "必要施工超出资源和专业能力时只做方案，不自行搭建危险装置"], missingForPublication: ["当前仅有官方开放主题或通用交付要求的编辑练习路线，尚未取得足够具体的完整官方题或完整公开作品；不计入严格L3案例"]
    }
  }
];
