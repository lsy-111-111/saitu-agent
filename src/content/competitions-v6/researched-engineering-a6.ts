import { authoredDeepCase, readSource, type ResearchedContent } from "./research-types";

const source = (...args: Parameters<typeof readSource>) => ({ ...readSource(...args), evidenceArtifact: "artifacts/v6/content-research/engineering-a-reading-log.json" });
const smartcarSource = source("smartcar-2025-outdoor-ros", "https://www.smartcar.zone/upload/files/2025/9/%E8%B5%9B%E9%A1%B9%E4%B8%80-%E5%AE%A4%E5%A4%96ROS%E6%97%A0%E4%BA%BA%E8%BD%A6%E8%B5%9B%EF%BC%88%E9%AB%98%E6%95%99%E7%BB%84%EF%BC%89%E6%AF%94%E8%B5%9B%E8%A7%84%E5%88%99.pdf", "第二十届室外ROS无人车赛高教组规则", "全国大学生智能汽车竞赛室外赛官网", "2025室外ROS高教组，不套用室内竞速和职教组", "完整14页：任务第2—6页，评分第7—8页，资格交付第8—12页，设备第13—14页", "2025-07");

export const engineeringResearchA6: ResearchedContent[] = [{
  seriesId: "smart-car", name: "全国大学生智能汽车竞赛", organizer: "全国大学生智能汽车竞赛组织委员会", aliases: [], authorAgentId: "/root",
  editionId: "2025-20-outdoor", edition: "2025第二十届室外赛历史档案", groupId: "higher-education", group: "室外ROS高教组", scopeId: "china-2025-outdoor-ros", scope: "2025室外ROS高教组完整规则", origin: "legacy_135", trackId: "outdoor-ros-mapping", trackName: "室外ROS：首圈建图、次圈导航", taskFamily: "engineering-prototype", subjectDomains: ["engineering"], factStatus: "historical", registrationStatus: "historical", registrationNote: "2025规则作为历史准备任务；下一届赛道、设备和资格需重新核对。",
  sources: [smartcarSource],
  verified: {
    eligibility: { text: "2025该赛项面向全日制在校专科、本科及研究生，每队2—5名学生、1—2名指导教师；线下赛不同队伍不能共用同一设备。", source: 0 },
    track: { text: "首圈探索并构建二维地图，次圈依据该地图导航、识别停车牌并停入相应区域。现场随机挡板必须出现在地图中；红灯区域须停车3秒。", source: 0 },
    participation: { text: "按室外赛安排报名并提交资料，线下自主运行和展示地图；若改为线上，另需三机位运行视频与赛道测量视频，不得遥控或伪造记录。", source: 0 },
    deliverables: { text: "线下赛除现场比赛外，还须按赛前通知通过指定百度网盘提交源码与技术手册压缩包，每队限提交一次；手册至少五个案例。规则要求使用ROS2，使用ROS1有100秒罚时。", source: 0 },
    rubric: { text: "运行80分、技术手册20分；有效时间为首圈30%与次圈70%的耗时加罚时。第二圈停车失败加罚20秒，未在比赛中建图加罚50秒；赛道中停止运行超过10秒判本次任务失败。手册按创新、实用、复杂程度和可复现性评价，每个案例最多4分。复现性一项能结合所提交源码成功复现计1分，否则计0分。", source: 0 }
  },
  eligibilityRules: [
    { id: "smartcar-ros-degree", field: "degree", operator: "in", value: ["vocational", "undergraduate", "master", "doctorate"], factIds: ["smart-car:v2:eligibility"], note: "2025室外ROS高教组资格，不能泛化到其他赛道" },
    { id: "smartcar-ros-enrolled", field: "enrolled", operator: "eq", value: true, factIds: ["smart-car:v2:eligibility"], note: "在校" },
    { id: "smartcar-ros-fulltime", field: "fullTime", operator: "eq", value: true, factIds: ["smart-car:v2:eligibility"], note: "全日制" },
    { id: "smartcar-ros-min", field: "teamSize", operator: "min", value: 2, factIds: ["smart-car:v2:eligibility"], note: "至少两名学生" },
    { id: "smartcar-ros-max", field: "teamSize", operator: "max", value: 5, factIds: ["smart-car:v2:eligibility"], note: "至多五名学生" }
  ],
  task: "把感知、建图、导航和停车串成能处理现场变化的闭环，用日志解释失败并验证改进。",
  roles: [{ name: "建图与导航", task: "检查地图、定位和路线规划，使第二圈使用首圈真实结果", skills: ["programming", "mathematics", "engineering"], evidence: "你如何发现地图漂移，并排除只在固定场地有效的方案？", output: "本人节点配置、地图对照和导航故障记录" }, { name: "视觉与系统测试", task: "实现标志识别和停车状态切换，记录罚时与失败条件", skills: ["programming", "data-analysis", "electronics"], evidence: "灯光、角度或停车牌变化后，你测了多少次而非只选成功视频？", output: "识别评测、状态日志和可复现手册案例" }],
  gain: "可形成ROS节点集成、机器人测试和工程文档作品。设备平台已约束时，个人价值更依赖算法理解、调试证据和复现能力。",
  entry: "先掌握Linux、基本程序和ROS消息，再在仿真或已有平台做一个子任务；喜欢汽车不等于已经具备控制与感知能力。",
  completion: "练习时应把两圈运行、现场建图和指定停车分别跑通。按该届规则，停车失败或未在比赛中建图会加罚时间；赛道中停止运行超过10秒则判本次任务失败。提升成绩还要减少罚时、提高第二圈效率并写出可复现的手册。",
  investment: "编辑建议四周每周5—8小时验证子系统；正式参赛需要兼容设备、室外封闭测试场地、指导老师和团队。整套设备、报名和差旅费用未核，不能认定低成本。",
  fit: ["愿意读日志定位机器人失败", "能够与硬件或控制同学共同复测"], avoid: ["只想遥控演示", "没有设备和测试资源且无法获得"],
  trial: { action: "在ROS2仿真或已有教学平台记录两圈任务状态，改变一处障碍位置，检查地图与导航是否真正响应。", output: "状态图、日志与前后两次地图", check: "仿真与实测分开，不把预存地图重放当现场建图。", reflection: "你更喜欢地图与算法，还是测试、系统集成和问题定位？" },
  remaining: ["设备条款3.2称指定、4.3称推荐，采购前须向组委会确认允许型号与替代范围", "下一届资格、报名窗口、收费及当地选拔安排待核"],
  deepCase: { ...authoredDeepCase({
    seriesId: "smart-car", task: "2025室外ROS高教组：首圈建图、次圈导航与随机停车牌任务。", title: "用现场变化检验建图导航是否真实有效", sourceIds: ["smartcar-2025-outdoor-ros"],
    boundary: "完整读取14页历史原规则，设备措辞差异公开列为采购前待核事项；训练方案不宣称下一届适用，也不将软件模拟当实际车辆性能。",
    steps: ["将两圈、红灯等待和停车条件画成状态机，明确每种失败如何记录。", "改变挡板位置并重建地图，检查新变化进入系统而非加载旧地图。", "固定测试路线比较定位与速度设置，分别记录耗时、碰撞和停车失败。", "把五个调试案例写成别人按源码能重复的步骤，保留失败样例。"],
    questions: ["第二圈变快是否以漏停红灯或撞桶为代价？", "地图包含现场新挡板，能否证明生成时间与本次运行一致？", "技术手册中的每项改进能否从源码和日志重现？"],
    rubrics: [["运行80分", "编辑检查：两圈耗时和每类罚时分别统计"], ["手册20分", "编辑检查：五个案例包含问题、改动、复现与结果"]],
    roles: [{ role: "导航实现", steps: ["配置节点和坐标", "验证地图更新", "比较路线参数"], contributionProof: "本人代码差异和同场景重复测试" }, { role: "系统验证", steps: ["定义失败事件", "构建变化场景", "编写复现案例"], contributionProof: "本人测试用例、失败日志和修复验证" }],
    weeks: [["建立ROS2与任务状态机", "能解释节点间数据与各状态条件"], ["验证现场建图与变化响应", "新障碍确实进入地图"], ["接入标志和停车并重复测试", "每类失败有计数与原因"], ["优化耗时并整理复现手册", "相同完成条件下性能更好且可复核"]],
    exits: ["缺真实设备时保留明确标注的仿真学习成果", "运行仍不稳定时先停止提速，处理定位、状态切换和测试覆盖"]
  }), requirementMapping: [
    { requirement: "使用ROS2实现；用ROS1的罚时按当届规则处理", evidence: "编辑检查：记录终端显示的运行版本。", factIds: ["smart-car:v2:deliverables"] },
    { requirement: "在比赛过程中建立地图，并展示现场障碍", evidence: "编辑检查：核对当次地图、挡板位置及原始日志；未建图按规则加罚。", factIds: ["smart-car:v2:track", "smart-car:v2:rubric"] }
  ] }
}];
