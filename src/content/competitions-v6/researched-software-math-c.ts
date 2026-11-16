import { readSource, authoredDeepCase, type ResearchedContent } from "./research-types";
import { pilotContents } from "./pilots";
const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/software-math-c-reading-log.json" });
const cumcm = pilotContents.find(content => content.seriesId === "national-college-math-modeling")!;
export const softwareMathResearchC: ResearchedContent[] = [
  {
    ...cumcm, name: "全国大学生数学建模竞赛", organizer: "中国工业与应用数学学会", aliases: ["CUMCM"], authorAgentId: "/root/continue_catalog", editionId: "2026", edition: "2026本科组A题（历史）", groupId: "undergraduate", group: "本科组（含可选择本组的高职高专生）", scopeId: "china-2026-a", scope: "2026全国本科组A题及2026规则；地方费用和新届资格另核", origin: "legacy_135", subjectDomains: ["science", "engineering", "agriculture"], factStatus: "historical", registrationStatus: "historical", registrationNote: "2026赛题9月10日发布，本记录用于赛后学习；不表示当前报名开放。",
    sources: [source("cumcm-c-charter", "https://www.mcm.edu.cn/html_cn/block/44e92058f537729c6b6a62a3662ee417.html", "全国大学生数学建模竞赛章程", "全国组委会", "2023章程及2026规则入口", "第二条评奖标准与第三条资格形式"), source("cumcm-c-format", "https://www.mcm.edu.cn/html_cn/node/4cd596519c9eb9fbd866398f6df0caa3.html", "2026论文格式规范", "全国组委会", "2026论文及代码支撑材料", "第三至十一条全文", "2026-03-03"), source("cumcm-c-rules", "https://www.mcm.edu.cn/html_cn/node/9d8e511fe7a1447b35f53a82c908e2e0.html", "2026参赛规则", "全国组委会", "2026独立完成与AI政策入口", "第3—6条赛时协作界限", "2026-03-03"), source("cumcm-c-problem-a", "https://www.mcm.edu.cn/upload_cn/CUMCM2026Problems.zip", "2026官方赛题包A题药材的烘干问题", "全国组委会", "2026A题四页题干及附录1—4", "ZIP内A题PDF第1—4页；下载原件SHA见阅读日志", "2026-09-10")],
    verified: {
      eligibility: { text: "同校最多三名大学生组队、专业不限，研究生不能参加；高职高专学生可以选择本科组，指导限赛前与组织工作。", source: 0 },
      track: { text: "本科组按所选题解答现实问题，2026A题要求分析药材干燥过程的温度与含水率；不是医学疗效研究。", source: 3 },
      participation: { text: "通过学校和赛区组织，在规定时间独立完成；赛时不得与队外人员讨论，不能在交流平台浏览或讨论赛题内容。", source: 2 },
      deliverables: { text: "论文正文不超过30页，匿名电子论文PDF或Word不超过20MB，支撑包另不超过20MB并含可运行代码；A题另按模板产出四份结果表。", source: [1, 3] },
      rubric: { text: "章程主要考察假设合理、建模创造性、结果正确、表达清晰；没有提供本题固定分值或获奖概率。", source: 0 }
    },
    eligibilityRules: [{ id: "cumcm-degree", field: "degree", operator: "in", value: ["undergraduate", "vocational"], factIds: ["national-college-math-modeling:v2:eligibility"], note: "研究生不可参赛，高职高专可选本科组。" }, { id: "cumcm-team", field: "teamSize", operator: "max", value: 3, factIds: ["national-college-math-modeling:v2:eligibility"], note: "不要求必须三人。" }, { id: "cumcm-school", field: "sameInstitutionTeam", operator: "eq", value: true, factIds: ["national-college-math-modeling:v2:eligibility"], note: "同校。" }],
    remaining: ["当届个人全部费用与地方报名安排未知", "AI辅助允许但具体声明格式须再读2026AI工具规定；不能把赛后练习当赛时求助许可"],
    trial: { action: "读2026A题第一问，先统一厘米与米、摄氏温度与开尔文，列出初始和边界条件，再做一个明确标作简化练习的常系数模型。", output: "单位表、初边值条件与一张可复算曲线", check: "说明简化忽略了什么，并检查网格变化是否影响结论。", reflection: "你更喜欢物理建模、数值实现还是解释误差？" },
    deepCase: authoredDeepCase({ seriesId: "national-college-math-modeling", task: "2026A题药材的烘干问题：圆柱药材经预热与恒温干燥，求温度和含水率分布、全体位置达到含水率阈值的时刻，以及半径收缩后的干燥时长。", title: "真实题拆解：从空间分布到可靠的终止判据", sourceIds: ["cumcm-c-problem-a", "cumcm-c-charter", "cumcm-c-format"], boundary: "已读取官方ZIP中完整四页A题。下面是编辑研究路线，不是官方解答、实测数据或获奖论文；未给出未经计算的干燥小时数。", steps: ["把四问分为固定热物性预热、变物性全过程、全空间达标、收缩边界；第一问附录2的密度、比热容及导热系数固定，但扩散系数D=7×10^-9 exp(-0.89/C)仍随含水率C变化。常扩散系数只可另标为简化练习；记录各问附录，不能混用物性。", "先统一长度和温度单位，定义径向温度与干基含水率、中心对称和表面交换条件；若忽略端面，须解释圆柱近似的适用范围。", "用粗网格求解后细化时空网格，记录守恒、非负性与结果变化；附件给定环境数据超出观测区间时把延拓假设写明。", "第三问监测所有位置而不是平均含水率；第四问用附件半径变化更新域并检查守恒。导出题定密度的结果表，使论文表格能由同一代码重算。"], questions: ["平均含水率达标时，中心是否可能还未达标？", "公式中的温度单位错用摄氏度会影响什么？", "收缩导致路径变短与物性改变，能否拆开比较？"], rubrics: [["假设合理性", "以几何近似、边界与数据延拓表说明模型适用条件。"], ["结果正确性", "提供网格收敛、单位核查、守恒检查以及结果表复算记录。"], ["创造性与表达清晰", "比较逐步增加机制前后的必要性，说明新增复杂度究竟改善哪类误差。"]], roles: [{ role: "建模与单位检查", steps: ["划分四问", "定义条件", "核对物性与单位"], contributionProof: "模型版本、假设表与公式核查记录" }, { role: "数值与复算", steps: ["实现简化基线", "细化网格", "导出表格"], contributionProof: "程序、运行参数和误差对比" }], weeks: [["原题四问与单位梳理", "逐条对应输入、条件和输出模板"], ["为第一问建立干燥时间与含水量的简化模型", "可重复生成曲线并检查守恒"], ["加入变物性和终止条件", "区分全空间与平均值判据"], ["收缩边界与报告复核", "解释局限且所有展示表可复算"]], exits: ["不能解释微分方程边界条件时先回到一问的简化模型", "数值误差未稳定时不宣称精确干燥时间"] })
  },
  {
    seriesId: "comap-mcm-icm", name: "美国大学生数学建模竞赛MCM/ICM", organizer: "COMAP", aliases: ["美赛"], authorAgentId: "/root/continue_catalog", editionId: "2026", edition: "2026 MCM A（历史）", groupId: "undergraduate-or-below", group: "本科及以下在校团队", scopeId: "global-2026-mcm-a", scope: "2026 MCM A题及当届规则；不将2027页面回填为2026", trackId: "mcm-a", trackName: "连续建模A题", taskFamily: "data-modeling", subjectDomains: ["science", "engineering"], origin: "legacy_135", factStatus: "historical", registrationStatus: "historical", registrationNote: "2026赛期1月29日至2月2日（EST），现仅作历史题学习。",
    sources: [{ ...source("comap-c-2026-rules", "https://www2.scut.edu.cn/_upload/article/files/e5/f2/8871d9db4b7b8ea970516352c699/5b837653-8e0c-41dc-9238-97f734bcb90f.pdf", "COMAP 2026 Contest Rules, Registration and Instructions", "COMAP（华南理工大学托管当届原件）", "2026队伍、报名费用、论文与评阅要求", "PDF第2—5、7—11页；旧email文字与新在线流程冲突由当届镜像澄清"), authority: "official_host" }, source("comap-c-2026-mirror", "https://www.comapmath.com/MCMICM/", "2026 MCM/ICM官方镜像赛题页", "COMAP", "2026时间与新在线提交流程", "Contest Dates及Online Submission Process"), source("comap-c-2026-a", "https://www.contest.comap.org/undergraduate/contests/mcm/contests/2026/problems/2026_MCM_Problem_A.pdf", "2026 MCM Problem A Modeling Smartphone Battery Drain", "COMAP", "2026A题全部要求及报告格式", "完整PDF第1—3页", "2026-01-29")],
    verified: {
      eligibility: { text: "一至三名同校本科或以下在校学生，可全日制或非全日制；须有校内advisor，学生自己也可担任，不是必须另请教师。", source: 0 },
      track: { text: "当届六题选一且只交一题；A题要求锂电手机电量的连续时间模型，不能只做离散拟合或黑箱预测。", source: [1, 2] },
      participation: { text: "Advisor和团队分别注册，取得控制号，开赛后不得更换新增队员；2026官方镜像明确在线交PDF、不再要求邮件提交。", source: [0, 1] },
      deliverables: { text: "英文匿名PDF含摘要、模型、验证、引用，主报告最多25页；使用AI须另外附使用报告，该附加报告不计25页。", source: [0, 2] },
      rubric: { text: "当届规则强调思路、问题分析、模型和数学方法，摘要、假设依据、检验及局限要清楚；没有及格分或统一分数线，允许部分解答。", source: 0 },
      investment: { text: "2026注册每队100美元且不退费；不能按三人均分推定个人必付金额，汇率与学校资助另核。", source: 0 }
    },
    eligibilityRules: [{ id: "comap-degree", field: "degree", operator: "in", value: ["undergraduate", "vocational", "high-school"], factIds: ["comap-mcm-icm:v2:eligibility"], note: "本科及以下，非全日制也可。" }, { id: "comap-team", field: "teamSize", operator: "max", value: 3, factIds: ["comap-mcm-icm:v2:eligibility"], note: "可单人或二人，不要求满队。" }, { id: "comap-school", field: "sameInstitutionTeam", operator: "eq", value: true, factIds: ["comap-mcm-icm:v2:eligibility"], note: "培训机构不能冒充学籍学校。" }],
    task: "用可解释的连续时间模型说明手机电池怎样随使用方式变化，并把不确定性转换为有条件的建议。",
    roles: [{ name: "机制建模", task: "定义状态、输入、耗能项与参数来源，形成可检验预测", skills: ["research", "data-analysis"], evidence: "哪个耗能因素来自证据，哪个只是暂定假设？", output: "方程、假设和敏感性方案" }, { name: "计算与论证", task: "计算场景差异并检查结论是否依赖某一个参数", skills: ["programming", "writing"], evidence: "参数变化到什么范围会推翻你的建议？", output: "脚本、比较图与英文摘要" }],
    gain: "可形成建模、验证、英文表达与贡献记录；历史题训练不等于真实参赛或已获奖。",
    entry: "应能理解基本微积分与数据图表，可先做常功率耗电基线；英文表达可逐步练习。", completion: "难点是模型有物理解释、参数合理和论证连贯，不能只展示拟合漂亮的曲线。",
    investment: "编辑建议四周每周4—6小时完成一个历史题缩小版本；正式赛期需要连续投入及注册费，个人净支出待核。",
    fit: ["喜欢解释现实系统的变化", "愿意把局限写进结论"], avoid: ["只想套机器学习模型不解释机制", "无法阅读英文题目与检查模型输出"],
    trial: { action: "用题目A建立一个常功率电量下降基线，明确假设数据，再比较两种屏幕使用情境。", output: "状态方程、参数依据与两条曲线", check: "量纲一致，电量不出现负值，能解释哪条假设最影响剩余时长。", reflection: "你愿意为了更可信的解释放弃更复杂的算法吗？" },
    remaining: ["规则PDF含email提交及小于20MB要求；当届镜像明确改为在线流程，镜像未给出不同文件大小，因此不声明大小冲突", "当前报名资格和美元自费金额不能用历史记录推断"],
    deepCase: authoredDeepCase({ seriesId: "comap-mcm-icm", task: "2026 MCM A题：建立锂电手机SOC的连续时间模型，预测多种初始电量和使用场景下耗尽时间，分析敏感性并给节能建议。", title: "真实题拆解：电池续航预测怎样避免黑箱拟合", sourceIds: ["comap-c-2026-a", "comap-c-2026-rules"], boundary: "已读三页官方题干与2026规则评阅说明。以下为编辑分析路线，未运行模型、不宣称任何节能百分比；不把题目要求编成官方评分权重。", steps: ["以剩余电量或能量为状态，先列功率与容量单位，从最小守恒关系建立连续时间基线，明确何时达到耗尽。", "逐项引入屏幕、处理器、网络等负载，只采用开放许可且可引用的数据；参数证据不足时给区间而不是伪造精确值。", "比较不同初始状态和使用模式，对照可观察或有依据的行为，给预测区间并找出失效情境。", "改变参数、使用波动及老化假设，检验哪类建议稳健；摘要先说主要发现及限制，再用图表和引用支持。"], questions: ["连续状态方程在哪里，只有离散回归是否满足题意？", "容量下降与功耗增加能否从同一条曲线区分？", "哪种条件下节能建议可能反转？"], rubrics: [["思路、模型和方法", "把守恒关系、参数依据与新增机制的理由串成可追踪论证。"], ["摘要与分析表达", "摘要明确有条件的主要结论，图表可对应方法与局限。"], ["模型检验", "给出误差、敏感性或稳定性检查，而非只用训练曲线证明有效。"]], roles: [{ role: "模型提出者", steps: ["定义状态", "列耗能项", "推导时间关系"], contributionProof: "方程版本与参数出处" }, { role: "验证与表达者", steps: ["设对照场景", "检验敏感性", "提炼摘要"], contributionProof: "脚本、误差图和摘要修改记录" }], weeks: [["题意与连续模型基线", "量纲一致且能解释状态变化"], ["引入一项有据机制", "说明参数来源及适用范围"], ["比较情境和敏感性", "保留失败或反常结果并解释"], ["形成英文报告缩稿", "主要结论能由代码重算且写明AI使用"]], exits: ["没有合法可用数据时先做明确的参数区间分析", "无法解释模型状态与单位时回到基线而非叠加算法"] })
  },
  {
    seriesId: "icpc-programming", name: "国际大学生程序设计竞赛ICPC", organizer: "ICPC Foundation", aliases: ["ICPC"], authorAgentId: "/root/audit_catalog", editionId: "2025-world-finals", edition: "2025全球总决赛（历史题学习）", groupId: "qualified-university-team", group: "已晋级的三人高校队", scopeId: "world-finals-baku-2025", scope: "2025巴库总决赛规则与D题；不是地区赛报名资格", trackId: "world-finals", trackName: "全球总决赛算法题", taskFamily: "software-algorithms", subjectDomains: ["science", "engineering"], origin: "legacy_135", factStatus: "historical", registrationStatus: "historical", registrationNote: "2025总决赛已经结束；读历史题不代表具备总决赛名额，当前区域资格须另核。",
    sources: [source("icpc-c-2025-rules", "https://icpc.global/community/history/brochures/world-finals-2025-brochure.pdf", "2025 ICPC World Finals Baku Brochure", "ICPC Foundation", "2025总决赛资格、出行、赛制及评分", "PDF第24—27页原文；本地pypdf读取，sha见日志"), source("icpc-c-2025-d", "https://worldfinals.icpc.global/problems/2025/finals/problems/problemset.pdf", "2025 ICPC World Finals Problem Set", "ICPC Foundation", "D题Buggy Rover完整题面与样例", "PDF第7—8页（D题）", "2025-09-04")],
    verified: {
      eligibility: { text: "须通过地区赛晋级或获邀请，每校至多一队；总决赛沿用晋级的三名队员、不设替补，队员不能已有两次总决赛参赛经历，教练不能由队员兼任。", source: 0 },
      track: { text: "总决赛为英语题的限时程序设计，通常五小时；本条具体研究D题Buggy Rover，不推断其它赛区赛程。", source: 0 },
      participation: { text: "教练完成资格认证与必要签证手续，选手提供晋级学期在读证明并参加要求的现场活动；不是个人网上自由直报总决赛。", source: 0 },
      deliverables: { text: "提交程序由评测接受或拒绝；D题输入网格与移动记录，输出能解释该记录的方向优先序最少改变次数，时限2秒。", source: [0, 1] },
      rubric: { text: "按解题数排名；2025前十二名同解题数比较总耗时，再比最后通过时间。已解题的先前拒绝提交每次罚20分钟，编译错误不罚，未解题不计时。", source: 0 },
      investment: { text: "邀请日期范围内主办方提供教练及三名选手住宿与安排餐食，往返交通由队伍负责；不能据此说全球总决赛零成本。", source: 0 }
    },
    eligibilityRules: [{ id: "icpc-qualified", field: "priorQualification", operator: "requires_confirmation", value: "2025全球总决赛晋级或邀请与认证", factIds: ["icpc-programming:v2:eligibility"], note: "在校不等于获得总决赛资格。" }, { id: "icpc-team", field: "teamSize", operator: "eq", value: 3, factIds: ["icpc-programming:v2:eligibility"], note: "晋级原三人。" }, { id: "icpc-coach", field: "mentor", operator: "eq", value: true, factIds: ["icpc-programming:v2:eligibility"], note: "队员不得兼教练。" }],
    task: "把复杂叙述转成状态与约束，设计可证明正确且满足时限的算法，并用反例发现错误。",
    roles: [{ name: "推理与证明", task: "抽象状态、比较算法并证明关键步骤", skills: ["programming", "research"], evidence: "哪个反例排除了你最初的贪心想法？", output: "不变量、复杂度分析与手工反例" }, { name: "实现与测试", task: "实现求解器、暴力小规模对照并记录错误", skills: ["programming", "data-analysis"], evidence: "样例通过后，你怎样发现边界或性能问题？", output: "代码、随机小例对拍与修订记录" }],
    gain: "可展示算法推理、实现和团队协同；历史训练提交不是正式比赛成绩，奖项仍要真实核验。",
    entry: "需能独立写基础程序和理解复杂度，可先模拟小规模方向选择，不必直接冲全球决赛难度。", completion: "难点是正确性证明与高效实现同时成立，限时中还需选题和协作。",
    investment: "编辑建议四周每周4小时研究一题及反例；正式晋级、旅行和学校资助需另外落实。",
    fit: ["喜欢可反驳的推理与精确反馈", "愿意用测试推翻自己的算法"], avoid: ["只想复制题解获得通过记录", "希望无需选拔直接参加全球总决赛"],
    trial: { action: "对D题第一样例手算每一步允许的方向优先序，再枚举24种排列检查一个固定优先序能解释多长前缀。", output: "四步允许集合与一次改变的解释", check: "说明为何至少需要改变一次，并核对题目样例输出。", reflection: "你更喜欢抽象证明、写实现还是设计反例？" },
    remaining: ["当前地区赛年龄、学籍期限和报名条件未在此总决赛记录核验", "地方费用、校队选拔与参赛机会不得由历史总决赛题推导"],
    deepCase: authoredDeepCase({ seriesId: "icpc-programming", task: "2025总决赛D题Buggy Rover：机器人在网格按四方向优先序选择第一个可走方向，已知移动记录，求最少几次改变优先序才能解释全过程。", title: "真实算法题拆解：把方向序变化变成可检验状态", sourceIds: ["icpc-c-2025-d", "icpc-c-2025-rules"], boundary: "已读D题完整两页、三组样例及2025评分原文。下列为编辑推理路线，不声称已在官方评测通过；未使用站上标注unofficial的题解冒充官方答案。", steps: ["枚举四方向的24种优先序，对每一步先计算可走方向，再筛出会选观察方向的排列；障碍与边界必须在同一判定中。", "以一步结束时采用的优先序为状态，记录解释到该步的最少改变次数；首步选择任何可行序不算改变。", "转移分保持原排列与从其它排列改变两类，只保留与本步一致的状态；用小网格暴力枚举分段作独立对照，再考虑利用全局最小值优化。", "复核三组官方样例与全程不变、仅一步、连续受阻等自建边界；给出状态数与步数相乘的复杂度，不能以样例通过替代证明。"], questions: ["开始选一个优先序为什么不能算一次改变？", "只统计观察方向变化次数为什么不成立？", "某方向在边界不可走，会怎样放宽允许排列集合？"], rubrics: [["评测接受与正确性", "用状态定义、不变量、样例及独立小规模对照说明为什么输出最小改变次数。"], ["时间限制与提交效率", "记录复杂度、边界检查与拒绝原因；训练复盘不杜撰正式罚时。"]], roles: [{ role: "算法论证", steps: ["定义允许集合", "建立状态转移", "证明最优性"], contributionProof: "推导稿与反例修订" }, { role: "实现检验", steps: ["模拟移动", "实现动态规划", "对拍小规模"], contributionProof: "可运行代码、测试种子与错误日志" }], weeks: [["读题并用网格逐步手算原题样例", "能解释一次改变与零改变样例"], ["实现24状态基线", "逐步输出可行状态便于核对"], ["反例与复杂度验证", "小规模对照一致且边界无越界"], ["模拟限时解题并讲解方向优先序的判定依据", "不看题解解释证明和失败修订"]], exits: ["还不能模拟网格边界时先练基础数组与方向表示", "只会背转移却不能解释状态含义时暂停计时训练"] })
  }
];
