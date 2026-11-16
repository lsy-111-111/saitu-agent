import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";

const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/engineering-a-reading-log.json" });

/** Historical tasks remain useful preparation examples, without claiming current entry eligibility. */
export const engineeringResearchA5: ResearchedContent[] = [
  {
    seriesId: "national-college-electronic-design", governanceFactField: "participation", name: "全国大学生电子设计竞赛", organizer: "全国大学生电子设计竞赛组委会", aliases: [], authorAgentId: "/root",
    editionId: "2025-national", edition: "2025全国主赛历史档案", groupId: "undergraduate-task", group: "本科组题目（高职高专亦可选）", scopeId: "china-2025-c", scope: "2025全国主赛C题；不外推2026地方赛或下一届", origin: "legacy_135",
    trackId: "monocular-measurement", trackName: "C题：单目视觉测量装置", taskFamily: "engineering-prototype", subjectDomains: ["engineering", "science"], factStatus: "historical", registrationStatus: "historical", registrationNote: "2025主赛已经结束；用于提前准备和任务体验，当前报名须核对新通知。",
    sources: [source("electronics-2025-main-notice", "https://hnedc.hnie.edu.cn/__local/0/0D/80/FD1C067B95F5F7BF3968A58D3D5_331E6B71_D7CEE.pdf", "2025全国电子设计竞赛组织通知", "全国组委会，湖南赛区托管原件", "2025全国主赛资格、组织及收费", "PDF第3—6页，第四、六、七、八节"), { ...source("electronics-2025-c-task-shanghai-rar", "https://nuedc-sh.sjtu.edu.cn/storage/seiee/project/nuedc/article/2025/07/ae91eea2c584a04d97e0414dcaa5af10.rar", "2025全国本科题包：C题基于单目视觉的目标物测量装置", "全国组委会统一命题，上海赛区官方发布", "2025全国本科C题命题、限制及评分；不适用其他题或届次", "本科RAR内C题PDF共4页：第1页任务及框图，第2—3页基本与发挥、误差和限制，第4页评分表", "2025-07-30"), authority: "official_host", checkedAt: "2026-11-06", retrievedAt: "2026-11-06", evidenceArtifact: "artifacts/continuation-20261105/electronics-c-primary-source-01/author-reading.json" }, { ...source("electronics-2025-national-process", "https://www.nuedc-training.com.cn/index/news/details/new_id/333", "2025年全国大学生电子设计竞赛实施过程说明", "全国大学生电子设计竞赛组委会", "2025全国主赛的赛场、封存及全国评审组织方式", "一、竞赛组织与规则；三、关于评审工作，综合测评对象及全国初评后复测", "2025-07-15"), evidenceArtifact: "artifacts/continuation-20261105/electronics-c-content-correction-01/process-source-reading.json" }],
    verified: {
      eligibility: { text: "2025普通高校正式学籍全日制本科、高职高专学生三人组队，由学校报名。本科生只能选本科题；高职高专学生也可选本科题。三人均须全程参赛和评审。", source: 0 },
      track: { text: "C题用一只固定摄像头测量图形尺寸和距离 D。D 是目标物面标记点在基准面上的垂直投影点到基准线的距离。基本测距范围 100—200 厘米，一键结果须在 5 秒内给出。装置用外部 5V 直流稳压电源供电，同时实时测量该电源向整机输出的电流。", source: 1 },
      participation: { text: "2025制作时段为7月30日8时至8月2日20时；学校组织参赛，完赛后封存交件；被赛区推荐全国评奖的队伍全员参加综合测评，全国初评后，一等奖候选队及有关抽调队参加复测。比赛期间禁止与队外人员讨论，教师须回避。", source: [0, 2] },
      deliverables: { text: "提交设计报告、实物和登记表。报告封面和每一页不得出现参赛学校、代码、姓名，否则取消评审资格。报告正文限 A4 八页以内，首页另附不超过 300 字中文摘要，每页上方留出至少 3 厘米空白。队伍代码按实施说明写在另张密封纸规定位置；报告匿名要求不用于登记表。实物须可脱机测评。C题不得用PC、成品视觉测距产品或非视觉测距传感器；电流测量电路不得直接使用商品模块。", source: [0, 1, 2] },
      rubric: { text: "C题共120分：设计报告20、基本要求50、发挥部分50。报告检查方案、理论、电路程序、测试及规范；发挥要求进一步测复杂图形、倾斜目标和功耗。历史基本要求：距离和尺寸的绝对误差上限分别为5厘米、1厘米；发挥部分分别为2厘米、0.5厘米。", source: 1 },
      investment: { text: "2025报名费可由各赛区按实际情况确定，由学校支付；学校原则上提供场地、仪器及元件。个人垫付、耗材和差旅是否报销仍需问本校，不能认定总费用为零。", source: 0 }
    },
    eligibilityRules: [
      { id: "electronics-degree", field: "degree", operator: "in", value: ["undergraduate", "vocational"], factIds: ["national-college-electronic-design:v2:eligibility"], note: "2025本科题允许高职高专学生选择" },
      { id: "electronics-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["national-college-electronic-design:v2:eligibility"], note: "正式在校学籍" },
      { id: "electronics-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["national-college-electronic-design:v2:eligibility"], note: "全日制" },
      { id: "electronics-team", field: "teamSize", operator: "eq", value: 3, factIds: ["national-college-electronic-design:v2:eligibility"], note: "三人全程完成比赛及评审" }
    ],
    task: "把几何、图像处理和电路做成一个能重复测出真实数值的独立装置；解释误差、速度和功耗的取舍。",
    roles: [
      { name: "视觉与误差", task: "完成相机标定、图形识别与几何测量，检验不同距离和角度", skills: ["programming", "mathematics", "data-analysis"], evidence: "你怎样把像素误差转换为厘米误差，并用未参与调参的目标检查？", output: "本人标定程序、误差分布和失败样例" },
      { name: "电路与系统", task: "接入外部 5V 直流稳压电源，用自制电流测量电路实时测整机供电电流，完成按键和显示，测试端到端耗时", skills: ["electronics", "engineering", "programming"], evidence: "电流显示来自哪个实际测量环节，如何与参考仪器比较？", output: "本人电路、固件与整机测量记录" }
    ],
    gain: "可积累测量、嵌入式集成与实验记录作品。完成度取决于可复核指标；获奖遴选还包括综合测评，不能用做出一个演示预测奖项。",
    entry: "先会读图像和做简单几何测量；只会桌面Python可先做标定角色，正式装置仍需要电路与嵌入式队友。",
    completion: "训练自检先看基本项的误差和5秒时限；超时影响相应测试项得分，不等于自动失去参赛资格。再试复杂目标识别和功耗优化。",
    investment: "编辑建议四周每周5—8小时先验证测量链；需要相机、处理板、显示、电路工具和参考仪器，整套价格尚未核验。正式四天三夜赛制另需协调完整时间。",
    fit: ["喜欢用实测检验算法", "愿意分担硬件、程序和报告工作"], avoid: ["只准备在笔记本上演示识别", "把预设电流数值当真实测量"],
    trial: { action: "先做桌面局部标定：按标记点的垂直投影到基准线测量真值 D，在三种图形的位置中留出独立检查组，记录最大误差。电源电流、限时及脱机整机要求另行验证。", output: "标定说明、测试表和失败照片", check: "只声明实际测过的条件，电脑原型不冒充可参赛整机。", reflection: "你更愿意分析误差还是实现电路与端到端体验？" },
    remaining: ["下一届报名、赛题及当地费用尚未核实"],
    deepCase: authoredDeepCase({
      seriesId: "national-college-electronic-design", task: "2025全国C题：固定单目视觉测距、尺寸测量与实际功耗监测。", title: "从能识别图形到能证明测量准确", sourceIds: ["electronics-2025-c-task-shanghai-rar", "electronics-2025-main-notice", "electronics-2025-national-process"],
      boundary: "依据上海赛区发布的2025全国本科题包C题PDF四页、当届组织通知及实施过程说明。以下路线是历史题训练，不是在竞赛期间接受队外帮助，也不把训练作品当本人已获奖成果。",
      steps: ["先列出基本与发挥两档误差和设备限制，再决定处理平台。", "用独立测试位置检查距离和尺寸，不把调参样本作为全部评测证据。", "把实际电流采样、显示与视觉测量连通，记录从按键到结果的总耗时。", "再扩展重叠、编号和倾斜目标，逐个记录失败条件及功耗变化。"],
      questions: ["镜头或目标位置变化是否破坏标定假设？", "降低功耗后误差和耗时是否仍满足同一档要求？", "整机电流是仪器对照后的测量，还是代码中的固定值？"],
      rubrics: [["报告20分", "编辑检查：方案与误差分析能被原始测试支持"], ["基本要求50分", "编辑检查：分别复测三个基础目标及实际整机供电电流；电流相对误差绝对值不超过5%。"], ["发挥部分50分", "编辑检查：复杂目标和功耗功能分别留出测试证据"]],
      roles: [{ role: "视觉测量", steps: ["标定相机", "测量独立目标", "分析极端误差"], contributionProof: "本人程序提交与未用于调参的测试结果" }, { role: "硬件集成", steps: ["画测量链路", "接入实际采样", "验证整机时延功耗"], contributionProof: "本人电路、参考仪器读数与端到端日志" }],
      weeks: [["读题并验证几何测量", "独立测试中知道误差来自哪里"], ["连接电流测量和显示", "读数与参考仪器逐项对照"], ["测复杂目标并优化耗时", "报告每种目标通过和失败次数"], ["按历史条件完成整机演练", "队员能解释个人实现和未解决问题"]],
      exits: ["缺硬件或实验条件时只保留明确标注的算法学习项目", "基本测量尚不稳定时暂停加功能，先修复标定、采样和时延"]
    })
  },
  {
    seriesId: "engineering-practice-innovation", name: "中国大学生工程实践与创新能力大赛", organizer: "中国大学生工程实践与创新能力大赛组委会", aliases: [], authorAgentId: "/root/continue_catalog",
    editionId: "2025-national", edition: "2025全国赛历史命题", groupId: "undergraduate", group: "全日制在校本科生", scopeId: "china-2025-solar", scope: "2025新能源车太阳能电动车赛项已发布命题与评分", origin: "legacy_135",
    trackId: "solar-mechanical-car", trackName: "太阳能电动车：机械转向与能耗验证", taskFamily: "engineering-prototype", subjectDomains: ["engineering"], factStatus: "historical", registrationStatus: "historical", registrationNote: "2025任务供学习；不把预通知中的预计时间当作实际赛期，也不外推下一届。",
    sources: [
      source("engineering-2025-notice", "https://metc.ahpu.edu.cn/_upload/article/files/92/8a/5ddb18124a64b313f7c8b5b9c79f/7c26b85c-f310-4d89-aada-3dea0dadfe36.pdf", "2025中国大学生工创大赛预通知", "全国组委会，安徽工程大学托管", "2025全国赛通用身份和选拔路径", "PDF第2—3页第五节"),
      source("engineering-2025-solar-task", "https://aao.nuaa.edu.cn/_upload/article/files/02/ff/a4420c074e5999e610a8c98ccc5d/0ed54600-6b11-44ce-8486-44f64040253b.pdf", "2025新能源车赛道命题与运行", "全国组委会，南航托管原件", "2025太阳能电动车已发布命题；温差车另段不套用", "PDF第1—9页完整太阳能赛项"),
      source("engineering-2025-solar-score", "https://metc.ahpu.edu.cn/_upload/article/files/92/8a/5ddb18124a64b313f7c8b5b9c79f/e49d9f67-b295-4053-87eb-23330c932a78.pdf", "2025新能源车赛道评分与规则", "全国组委会，安徽工程大学托管", "2025已发布评分；后续现场细则需另核", "PDF完整9页，初赛与决赛分开计算")
    ],
    verified: {
      eligibility: { text: "预通知要求普通高等教育本科院校全日制在校本科生，一般每队3—4人、导师不超过2人；每名学生只能参加一个赛项，特殊赛项规则另行通知。", source: 0 },
      track: { text: "太阳能电动车任务要求自主轻量化设计、机械转向和单一电动驱动件；不得用电控转向，唯一读卡器用于识别UID并触发灯光和语音标记。", source: 1 },
      participation: { text: "校级初赛、省级选拔后进入全国决赛。太阳能赛项初赛与决赛独立计分，决赛还要求现场制造并实际替换零件和电路。", source: [0, 1] },
      deliverables: { text: "交付命题文档、可拆外壳的自制车辆及现场运行；文档需说明机械结构、供能选择、电路与能耗分析。不能购买成套作品替代个人设计。", source: 1 },
      rubric: { text: "已发布评分：初赛文档20、创意10、运行70；决赛创新实践20、充电10、运行70。初赛运行按标记30、距离20、语音20评分，决赛运行另按标记40、耗能10、距离20。", source: 2 }
    },
    eligibilityRules: [
      { id: "engineering-degree", field: "degree", operator: "eq", value: "undergraduate", factIds: ["engineering-practice-innovation:v2:eligibility"], note: "2025预通知通用本科范围" },
      { id: "engineering-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["engineering-practice-innovation:v2:eligibility"], note: "在校" },
      { id: "engineering-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["engineering-practice-innovation:v2:eligibility"], note: "全日制" },
      { id: "engineering-team", field: "priorQualification", operator: "requires_confirmation", value: "一般3—4人、每人限一个赛项及学校选拔", factIds: ["engineering-practice-innovation:v2:eligibility"], note: "预通知用一般人数，特殊情况须核具体赛项和学校安排" }
    ],
    task: "用机械机构控制路线，在有限储能下可靠完成标记任务，并能现场改造；它考验制造、供能和测试的共同效果。",
    roles: [{ name: "机械路线与制造", task: "设计转向机构、传动和可维护结构，检验轨迹误差", skills: ["mechanical", "engineering", "design"], evidence: "你的哪项机构修改改善了重复运行，而不是仅一次成功？", output: "本人图纸、加工过程及重复轨迹" }, { name: "供能与检测", task: "测试储能、充电、电流和标记播报，验证能源消耗", skills: ["electronics", "data-analysis", "programming"], evidence: "同条件下怎样测得改动减少能耗？", output: "本人电路、测试协议和原始测量表" }],
    gain: "可形成结构设计、制造调试和性能对照作品；现场制造规则使独立动手与解释过程更重要，不能仅靠购买底盘体现个人贡献。",
    entry: "先认识传动、供能和测量；可从一段机械轨迹或一次能耗试验进入，不必第一周做完整车辆。",
    completion: "完赛要把轨迹、标记和可靠供能连通；高分还要求创意、现场制作、能耗优化及重复运行稳定性。",
    investment: "编辑建议四周每周5—8小时做子系统验证，需要加工场地、导师、车辆材料及测量工具。报名、材料、差旅和个人承担比例未知，须向学校确认。",
    fit: ["喜欢制作并反复调试机构", "愿意把性能优化写成同条件实验"], avoid: ["没有加工与测试条件且暂时无法获得", "只想购买整套作品参赛"],
    trial: { action: "画一段不依赖电控转向的运动机构，用低成本模型验证三次轨迹，记录偏差和改动。", output: "机构草图与重复试验记录", check: "把仿真、桌面模型和真实车辆结果分别标清。", reflection: "你更想做结构加工、能耗测量还是现场系统调试？" },
    remaining: ["下一届资格、收费与赛项变化待核", "2025决赛创新实践细项、现场任务和后续补充规则不由早期附件推断"],
    deepCase: authoredDeepCase({
      seriesId: "engineering-practice-innovation", task: "2025太阳能电动车赛项：机械转向、UID标记与有限储能路线运行。", title: "让机械路线、标记和能耗共同成立", sourceIds: ["engineering-2025-solar-task", "engineering-2025-solar-score", "engineering-2025-notice"],
      boundary: "读取当届预通知、太阳能命题完整9页和完整9页评分。只采用已发布条款，不把未公布的现场细分评分编成确定事实。",
      steps: ["把机械转向限制、尺寸、储能和标记条件分别列为设计约束。", "先重复测轨迹，再加入读卡、灯光和语音，分离机械偏差与检测失败。", "同路线同载荷比较能耗，避免以少跑距离制造节能效果。", "模拟现场修改一个零件或电路后再次运行，检查可维护性和本人动手能力。"],
      questions: ["车跑得远是否意味着标记顺序正确？", "能耗下降时是否仍完成相同任务？", "外壳拆装和现场替换会不会改变重心、连接或路线？"],
      rubrics: [["初赛文档20与创意10", "编辑检查：设计取舍有计算和可拆实物对应"], ["初赛运行70", "编辑检查：标记、距离、语音分别记录，不能只看终点"], ["决赛创新20、充电10、运行70", "编辑检查：现场改造与充电和能耗验证保留独立记录"]],
      roles: [{ role: "机构制造", steps: ["建立运动草图", "制作并测重复轨迹", "练习现场替换"], contributionProof: "本人设计版本、加工记录和失效分析" }, { role: "供能与标记", steps: ["建立实际测量链", "检查读卡与语音", "同条件比较能耗"], contributionProof: "本人电路、测试数据及优化对照" }],
      weeks: [["核实资源并完成一段机械路线", "重复运行偏差有记录"], ["加入UID标签经过时触发一次标记与播报并验证，不另行要求停车", "区分漏读、误读和顺序错误"], ["测储能与结构优化", "同等任务完成度下比较能耗"], ["按现场更换条件修改电路并复测", "替换后仍能解释每次失败原因"]],
      exits: ["无法获得加工条件时改做明确标注的设计或数据分析练习", "可靠运行尚未实现时先处理摩擦、连接和检测，再追求更低能耗"]
    })
  }
];
