/** Presentation-only editorial copy. It never enters matching catalog records or hashes.
 * Each entry remains bound to the original task text and fact IDs; the reader
 * preserves the original claim basis, conditions and source relationships.
 */
export const COMPACT_TASK_COPY_VERSION_V7 = "saitu.compact-task-copy.20261110.v1";
export type CompactTaskCopyV7 = Readonly<{ text: string; sourceText: string; sourceFactIds: readonly string[] }>;

export const COMPACT_TASK_COPY_V7: Readonly<Record<string, CompactTaskCopyV7>> = {
  "google-code-jam:2022:qualification-3d-printing:historical-public-task:qualification-3d-printing-2022:v3": {
    "text": "从共享资源的各项约束提炼每一维可用的上限，构造满足指定总量等式的可行分配方案，并说明什么情况下不存在解。",
    "sourceText": "从共享资源约束提炼逐维上限，构造满足等式的可行解，并证明无解条件。",
    "sourceFactIds": [
      "google-code-jam:v2:track"
    ]
  },
  "google-kick-start:2022:round-a-speed-typing:historical-public-task:round-a-speed-typing-2022:v3": {
    "text": "把输入内容需要修复的故事转成子序列问题，用双指针保留原有字符顺序，并说明为什么所需删除次数能够唯一确定。",
    "sourceText": "把输入修复故事转成子序列问题，用双指针保持顺序并证明删除次数唯一。",
    "sourceFactIds": [
      "google-kick-start:v2:track"
    ]
  },
  "google-hash-code:2022:qualification-mentorship:historical-public-task:qualification-mentorship-2022:v3": {
    "text": "实现可核查的项目调度和技能成长模拟，再比较可行策略的分数，不把启发式结果说成最优。",
    "sourceText": "实现可核查的项目调度和技能成长模拟，再比较可行策略的分数，不把启发式结果说成最优。",
    "sourceFactIds": [
      "google-hash-code:v2:track"
    ]
  },
  "taiwan-child-rights-lesson-contest:2023-first:preschool-rights-learning:preschool-student:taiwan-2023-preschool-student:v3": {
    "text": "把抽象的学习目标逐步转成具体情境、互动活动与可检查的学习证据，并对所用教材内容逐项核查准确性。",
    "sourceText": "把抽象学习目标转成具体情境、互动活动与可检查的学习证据，并核查教材准确性。",
    "sourceFactIds": [
      "taiwan-child-rights-lesson-contest:v2:track"
    ]
  },
  "ncyu-special-education-demonstration:2016-2017-105:reading-lesson-design:pre-service-teachers:taiwan-105-special-education:v3": {
    "text": "将教学目标转成能够实际执行的课堂活动与可观察的学习评价，清楚解释教学支持措施所依据的证据及适用限制。",
    "sourceText": "将教学目标变成可执行活动和可观察评价，解释支持措施的依据与限制。",
    "sourceFactIds": [
      "ncyu-special-education-demonstration:v2:track"
    ]
  },
  "acm-student-research:2025-chi:hci-education-research:undergraduate:chi-2025-undergrad:v3": {
    "text": "把真实学习困难变成可研究的问题，用调查和公开证据支撑设计，诚实区分设计建议与已验证效果。",
    "sourceText": "把真实学习困难变成可研究的问题，用调查和公开证据支撑设计，诚实区分设计建议与已验证效果。",
    "sourceFactIds": [
      "acm-student-research:v2:track"
    ]
  },
  "apple-swift-student-challenge:2026:app-playground:individual-student:global-2026:v3": {
    "text": "把一个小问题做成可离线体验的小型交互程序，用运行效果和自己的文字解释技术与设计取舍。",
    "sourceText": "把一个小问题做成可离线体验的小型交互程序，用运行效果和自己的文字解释技术与设计取舍。",
    "sourceFactIds": [
      "apple-swift-student-challenge:v2:track"
    ]
  },
  "international-mathematics-competition:2026-33:proofs:individual:bulgaria-2026:v3": {
    "text": "把一个看似只需数值试算的问题转成完整的数学证明，清楚处理每个可能分支，让他人能够逐步核查推理。",
    "sourceText": "把一个看似能数值试算的问题转成完整证明，处理所有分支并让他人逐步检查推理。",
    "sourceFactIds": [
      "international-mathematics-competition:v2:track"
    ]
  },
  "dandad-new-blood:2026-share-your-passion:personal-social-campaign:eligible-creative:global-2026-dad-brief:v3": {
    "text": "把自己的创意实践变成一个能够持续展开、面向明确受众的社交内容系列，并用可审查样稿说明传播策略。",
    "sourceText": "把自己的创意实践变成一个能够持续展开、面向明确受众的社交内容系列，并用可审查样稿说明传播策略。",
    "sourceFactIds": [
      "dandad-new-blood:v2:track"
    ]
  },
  "aiaa-design-build-fly:2025-2026:aircraft-missions:university-team:2026-charter-flight:v3": {
    "text": "把飞行任务转成重量、能量、结构和操作约束，比较不同设计，并用可追溯测试证明系统能完成任务。",
    "sourceText": "把飞行任务转成重量、能量、结构和操作约束，比较不同设计，并用可追溯测试证明系统能完成任务。",
    "sourceFactIds": [
      "aiaa-design-build-fly:v2:track"
    ]
  },
  "china-undergraduate-physics-tournament:2020-rules:physics-fight:undergraduate:china-historical-2020:v3": {
    "text": "研究一个没有预设唯一解的物理现象，用实验与模型回答参数怎样影响结果，并能接受有依据的质疑。",
    "sourceText": "研究一个没有预设唯一解的物理现象，用实验与模型回答参数怎样影响结果，并能接受有依据的质疑。",
    "sourceFactIds": [
      "china-undergraduate-physics-tournament:v2:track"
    ]
  },
  "national-college-math-modeling:2026:undergraduate-group:undergraduate:china-2026-a:v3": {
    "text": "把一个现实问题简化为可解释的假设和模型，用数据计算、检验结果，再写成可复算的论文。",
    "sourceText": "把一个现实问题简化为可解释的假设和模型，用数据计算、检验结果，再写成可复算的论文。",
    "sourceFactIds": [
      "national-college-math-modeling:v2:track"
    ]
  },
  "comap-mcm-icm:2026:mcm-a:undergraduate-or-below:global-2026-mcm-a:v3": {
    "text": "用可解释的连续时间模型说明手机电池怎样随使用方式变化，并把不确定性转换为有条件的建议。",
    "sourceText": "用可解释的连续时间模型说明手机电池怎样随使用方式变化，并把不确定性转换为有条件的建议。",
    "sourceFactIds": [
      "comap-mcm-icm:v2:track"
    ]
  },
  "icpc-programming:2025-world-finals:world-finals:qualified-university-team:world-finals-baku-2025:v3": {
    "text": "把复杂的题目叙述转成清晰的状态与约束，设计可证明正确且满足时限的算法，并用具体反例发现错误。",
    "sourceText": "把复杂叙述转成状态与约束，设计可证明正确且满足时限的算法，并用反例发现错误。",
    "sourceFactIds": [
      "icpc-programming:v2:track"
    ]
  },
  "china-software-cup:2026-15:a3-learning-agents:a-higher-education:china-a3-2026:v3": {
    "text": "把一门课程的知识材料、学生对话与实际学习反馈串成能够清楚解释推荐依据的多智能体学习产品。",
    "sourceText": "把一门课程的知识材料、学生对话与学习反馈串成能解释推荐依据的多智能体学习产品。",
    "sourceFactIds": [
      "china-software-cup:v2:track"
    ]
  },
  "china-college-computer-design:2026-19:ai-industrial-vision:full-time-undergraduate:china-ai-industrial-2026:v3": {
    "text": "按2026年国赛工业视觉专项任务完成产品分类、目标计数、缺陷检测、尺寸检测和编号识别。",
    "sourceText": "按2026年国赛工业视觉专项任务完成产品分类、目标计数、缺陷检测、尺寸检测和编号识别。",
    "sourceFactIds": [
      "china-college-computer-design:v2:track"
    ]
  },
  "lanqiao-cup:2019-10:cpp-array-successor:cpp-a:china-provincial-cpp-a-2019:v3": {
    "text": "把对数组逐次查重的朴素过程转成可证明正确的后继查询，让大量重复值的处理仍然满足运行时间限制。",
    "sourceText": "把逐次查重的朴素过程转成可证明正确的后继查询，处理大量重复值而不超时。",
    "sourceFactIds": [
      "lanqiao-cup:v2:track"
    ]
  },
  "ccf-ccsp:2025:systems-programming-xor:csp-qualified-students:china-harbin-2025:v3": {
    "text": "利用数对之间最高的不同二进制位拆开计算各部分贡献，避免直接枚举二十万个数之间的所有配对。",
    "sourceText": "利用最高不同二进制位拆开数对贡献，避免枚举所有二十万个数之间的配对。",
    "sourceFactIds": [
      "ccf-ccsp:v2:track"
    ]
  },
  "national-college-mathematics:2011-3:calculus-third-derivative:non-mathematics:zhejiang-zjut-preliminary-2011:v3": {
    "text": "利用泰勒公式逐步消去未知常数项，再通过连续性把两个导数值之间的关系转为需要证明的存在性结论。",
    "sourceText": "利用泰勒公式消去未知常数项，再通过连续性把两个导数值之间的关系转为存在性结论。",
    "sourceFactIds": [
      "national-college-mathematics:v2:track"
    ]
  },
  "mathorcup:2026-16:d-three-dimensional-packing:undergraduate-d:china-spring-d-2026:v3": {
    "text": "先按货物运输的各项约束检查装箱方案是否可行，再比较空间利用、载重、车辆使用次数和成本之间的取舍。",
    "sourceText": "先检查装箱方案可行性，再比较空间、载重、车辆次数和成本的取舍。",
    "sourceFactIds": [
      "mathorcup:v2:track"
    ]
  },
  "yau-college-mathematics:2026-17:algebra-non-simple-group:undergraduate-individual:global-2026-historical-training:v3": {
    "text": "从有限群的阶数所满足的算术限制出发，转为研究群作用，再通过作用的核与阶数之间的矛盾，说明为什么不可能是单群。",
    "sourceText": "把群阶的算术限制转为群作用，通过核与阶数矛盾排除单群。",
    "sourceFactIds": [
      "yau-college-mathematics:v2:track"
    ]
  },
  "atcoder-beginner-contest:2025-427:d-simple-game:individual-open:global-online-abc427:v3": {
    "text": "从固定终点倒推有限步博弈的最优胜负，明确区分己方存在一个好选择，与对手的所有选择都不能造成不利这两种条件。",
    "sourceText": "从固定终点倒推最优胜负，把己方存在一个好选择和对手所有选择都无害区分开。",
    "sourceFactIds": [
      "atcoder-beginner-contest:v2:track"
    ]
  },
  "loreal-brandstorm:2026-luxe:future-fragrance:18-30-team:global-local-entry:v3": {
    "text": "把一种尚未满足的香氛使用需求转成可估算成本、包容不同使用者且能扩大供给的产品或服务。",
    "sourceText": "把一种尚未满足的香氛使用需求转成可估算成本、包容不同使用者且能扩大供给的产品或服务。",
    "sourceFactIds": [
      "loreal-brandstorm:v2:track"
    ]
  },
  "intercultural-competence:2025-liaoning:case-analysis:chinese-student-team:liaoning-semifinal:v3": {
    "text": "从具体的对话和行动分析跨文化误解的多种可能成因，再用英语说明每种解释的证据与改进沟通的办法。",
    "sourceText": "从具体对话和行动分析误解的多种成因，用英语说明解释的证据与改进沟通的办法。",
    "sourceFactIds": [
      "intercultural-competence:v2:track"
    ]
  },
  "if-student-award:2025-entry-guide:sdg-design:design-students-graduates:global-2025:v3": {
    "text": "把可持续设计概念的用户、工作机制、体验和资源约束讲清楚，并区分海报表达与实际效能验证。",
    "sourceText": "把可持续设计概念的用户、工作机制、体验和资源约束讲清楚，并区分海报表达与实际效能验证。",
    "sourceFactIds": [
      "if-student-award:v2:track"
    ]
  },
  "cfa-research-challenge:2024-2025-historical:equity-research:university-team:global-2024-2025-report:v3": {
    "text": "追溯股票研究报告中的经营假设如何进入现金流和估值，再逐项检查最能改变结论的风险，解释这些判断所依赖的假设。",
    "sourceText": "追溯研究报告中经营假设如何进入现金流和估值，再检查最能改变结论的风险。",
    "sourceFactIds": [
      "cfa-research-challenge:v2:track"
    ]
  },
  "market-research-analysis:2025-15-undergraduate:wenjuan-ai:undergraduate-3-5:china-cau-submission:v3": {
    "text": "调查真实平台使用者如何使用或拒绝AI功能，把可复核调查转成产品需求与改进优先级。",
    "sourceText": "调查真实平台使用者如何使用或拒绝AI功能，把可复核调查转成产品需求与改进优先级。",
    "sourceFactIds": [
      "market-research-analysis:v2:track"
    ]
  },
  "national-college-industrial-design:2024-7:product-system:fulltime-university:heilongjiang-rules-national-work:v3": {
    "text": "从完整的产品展板逐项检验收纳、展开、操作和维护的逻辑，再清楚区分造型表达与实际工程可行性。",
    "sourceText": "从完整产品展板检验收纳、展开、操作和维护的逻辑，再区分造型表达与工程可行性。",
    "sourceFactIds": [
      "national-college-industrial-design:v2:track"
    ]
  },
  "ecommerce-innovation-creativity-entrepreneurship:2025-15-rural:rural-commerce:university-3-5:china-rural-practical:v3": {
    "text": "在授权范围和实际履约能力都已经明确的前提下，为一个真实农产品制定连贯的选品、营销、交易与复盘流程。",
    "sourceText": "在授权和履约能力明确后，为一个真实农产品制定选品、营销、交易与复盘流程。",
    "sourceFactIds": [
      "ecommerce-innovation-creativity-entrepreneurship:v2:track"
    ]
  },
  "chongqing-rural-revitalization:2025-5:bencao-cultural-tourism:students-graduates-2-5:chongqing-regular:v3": {
    "text": "针对本草花创谷的真实场地与菊花产业资源，提出有明确客源、运营责任和落地成本的农文旅项目。",
    "sourceText": "针对本草花创谷的真实场地与菊花产业资源，提出有明确客源、运营责任和落地成本的农文旅项目。",
    "sourceFactIds": [
      "chongqing-rural-revitalization:v2:track"
    ]
  },
  "chinese-classics:2025-zhejiang-13:classics-recitation:huzhou-individual:zhejiang-huzhou-local:v3": {
    "text": "把指定古文中的认识转折转成有文本依据的停连、重音和语气，让听众听懂而非只感到情绪强烈。",
    "sourceText": "把指定古文中的认识转折转成有文本依据的停连、重音和语气，让听众听懂而非只感到情绪强烈。",
    "sourceFactIds": [
      "chinese-classics:v2:track"
    ]
  },
  "iot-design:2026-13:espressif-aiot:regular-university:china-espressif:v3": {
    "text": "使用指定乐鑫芯片融合传感器数据，接入云端大模型，实现设备响应模型指令，或上传非音视频的感知数据供模型处理。",
    "sourceText": "使用指定乐鑫芯片融合传感器数据，接入云端大模型，实现设备响应模型指令，或上传非音视频的感知数据供模型处理。",
    "sourceFactIds": [
      "iot-design:v2:track"
    ]
  },
  "chemical-engineering-design:2026-20:clean-styrene-plant:undergraduate:china-styrene:v3": {
    "text": "把市场和工艺选择连成物料、能量、设备、布置及经济论证相互一致的分厂方案；重点是可追溯设计而非真实搭建化工装置。",
    "sourceText": "把市场和工艺选择连成物料、能量、设备、布置及经济论证相互一致的分厂方案；重点是可追溯设计而非真实搭建化工装置。",
    "sourceFactIds": [
      "chemical-engineering-design:v2:track"
    ]
  },
  "physics-experiment-innovation:2026-12:ice-metal-friction:assigned-domestic:china-ice-metal:v3": {
    "text": "把摩擦现象转成可测量问题，比较不同实验设计对结果和不确定度的影响，保留失败和重复测量。",
    "sourceText": "把摩擦现象转成可测量问题，比较不同实验设计对结果和不确定度的影响，保留失败和重复测量。",
    "sourceFactIds": [
      "physics-experiment-innovation:v2:track"
    ]
  },
  "embedded-chip-system-design:2026:gowin-real-time-synth:nuaa-undergraduate-graduate:nuaa-gowin-fpga:v3": {
    "text": "把演奏动作转成并行音频生成电路，验证总延迟不高于10毫秒，并确认声音由本人设计的硬件逻辑实时生成。",
    "sourceText": "把演奏动作变成有确定延迟的并行音频生成电路，证明听到的声音与个人设计的硬件逻辑对应。",
    "sourceFactIds": [
      "embedded-chip-system-design:v2:track"
    ]
  },
  "chemistry-experiment-innovation:2025-5:popular-science-cochineal:popular-science:china-2025-popular-science:v3": {
    "text": "将化学现象变为可重复、能解释并适合受众的实验活动；同时验证科学结论和观众是否理解。",
    "sourceText": "将化学现象变为可重复、能解释并适合受众的实验活动；同时验证科学结论和观众是否理解。",
    "sourceFactIds": [
      "chemistry-experiment-innovation:v2:track"
    ]
  },
  "national-college-electronic-design:2025-national:monocular-measurement:undergraduate-task:china-2025-c:v3": {
    "text": "把几何、图像处理和电路做成一个能重复测出真实数值的独立装置；解释误差、速度和功耗的取舍。",
    "sourceText": "把几何、图像处理和电路做成一个能重复测出真实数值的独立装置；解释误差、速度和功耗的取舍。",
    "sourceFactIds": [
      "national-college-electronic-design:v2:track"
    ]
  },
  "engineering-practice-innovation:2025-national:solar-mechanical-car:undergraduate:china-2025-solar:v3": {
    "text": "用机械机构控制路线，在有限储能下可靠完成标记任务，并能现场改造；它考验制造、供能和测试的共同效果。",
    "sourceText": "用机械机构控制路线，在有限储能下可靠完成标记任务，并能现场改造；它考验制造、供能和测试的共同效果。",
    "sourceFactIds": [
      "engineering-practice-innovation:v2:track"
    ]
  },
  "smart-car:2025-20-outdoor:outdoor-ros-mapping:higher-education:china-2025-outdoor-ros:v3": {
    "text": "把感知、建图、导航和停车串成能应对现场变化的完整闭环，用运行日志解释失败原因，再测试改进是否有效。",
    "sourceText": "把感知、建图、导航和停车串成能处理现场变化的闭环，用日志解释失败并验证改进。",
    "sourceFactIds": [
      "smart-car:v2:track"
    ]
  },
  "robomaster-university:2026-rmuc:engineering-core-assembly:university:rmuc-2026-core-assembly:v3": {
    "text": "在既有战队中承担装配机构、反馈控制或系统测试，解释机械动作与裁判状态为何一致或失配。",
    "sourceText": "在既有战队中承担装配机构、反馈控制或系统测试，解释机械动作与裁判状态为何一致或失配。",
    "sourceFactIds": [
      "robomaster-university:v2:track"
    ]
  },
  "biomod:2023:biomolecular-design:undergraduate:biomod-2023:v3": {
    "text": "把一个生物分子设计想法转成可以检验的研究问题，用清楚的表达让他人理解设计思路、现有数据以及结论的局限。",
    "sourceText": "把一个分子设计想法变成可检验的研究问题，并让他人看懂设计、数据和局限。",
    "sourceFactIds": [
      "biomod:v2:track"
    ]
  },
  "formula-student-china:2026-fscc:cost-manufacturing:university-combustion:china-2026-fscc-cost:v3": {
    "text": "用清楚的工程和成本证据判断一份扩产订单是否值得承接，并解释性能改进与资源投入之间的取舍及判断依据。",
    "sourceText": "用工程和成本证据判断一份扩产订单是否值得承接，并解释性能改进与投入的取舍。",
    "sourceFactIds": [
      "formula-student-china:v2:track"
    ]
  },
  "igem-collegiate:2026-collegiate:model-evidence:higher-education:igem-2026-higher-education:v3": {
    "text": "把生物系统模型、已有研究证据和团队决策联系起来，清楚区分实际做过的工作、现有证据支持的结论与尚不能证明的部分。",
    "sourceText": "将模型、研究证据和团队决策联系起来，准确说明做过什么与还不能证明什么。",
    "sourceFactIds": [
      "igem-collegiate:v2:track"
    ]
  },
  "mechanical-innovation-design:2026-12-regular:vegetable-processing:undergraduate-junior-college:china-regular-vegetable:v3": {
    "text": "把叶菜从脏乱、长短不一的来料处理成可称重包装的批量产品，设计连续工序及可解释的样机。",
    "sourceText": "把叶菜从脏乱、长短不一的来料处理成可称重包装的批量产品，设计连续工序及可解释的样机。",
    "sourceFactIds": [
      "mechanical-innovation-design:v2:track"
    ]
  },
  "national-structural-design:2026-19-shanghai:lele-cart:undergraduate-junior-college:shanghai-division:v3": {
    "text": "在材料、重量与制作时间限制下，用可行的车架和车轮结构把货物稳定运过复杂路面，比较轻量化与可靠性。",
    "sourceText": "在材料、重量与制作时间限制下，用可行的车架和车轮结构把货物稳定运过复杂路面，比较轻量化与可靠性。",
    "sourceFactIds": [
      "national-structural-design:v2:track"
    ]
  }
};
