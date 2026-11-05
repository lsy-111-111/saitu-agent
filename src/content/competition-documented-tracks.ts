import type { Competition, CompetitionMetadataSource, CompetitionTeamRequirement, CompetitionTrackMetadata } from "./competitions";
import type { CompetitionFitSignal, CompetitionPreferredOutput, CompetitionSkill, CompetitionStudentStage } from "@/types/competition-recommendation";

type Document = NonNullable<CompetitionTrackMetadata["document"]>;
type Track = CompetitionTrackMetadata;
const undergraduate: CompetitionStudentStage[] = ["undergraduate-1","undergraduate-2","undergraduate-3","undergraduate-4"];
const college = ["vocational", ...undergraduate] satisfies CompetitionStudentStage[];
const university = [...college,"master","doctorate"] satisfies CompetitionStudentStage[];

function activity(id: string, label: string, taskSummary: string, skills: CompetitionSkill[],
  fitSignals: CompetitionFitSignal[], preferredOutputs: CompetitionPreferredOutput[], rules: Partial<Track> = {}): Track {
  return { id, label, taskSummary, skills, fitSignals, preferredOutputs, ...rules };
}

function documented(title: string, url: string, scope: string): Document {
  return {title,url,scope};
}

const computer = documented("中国大学生计算机设计大赛组委会 · 第19届参赛要求",
  "https://jsjds.blcu.edu.cn/info/1078/1718.htm","2026年第19届全国比赛，省赛上推国赛。各省校选办法单独核对。");
const security = documented("西安交通大学教务处 · 第十九届全国大学生信息安全竞赛（作品赛）通知",
  "https://jwc.xjtu.edu.cn/info/1172/10355.htm","2026年全国作品赛的两条分支；校内推荐和后续报名流程仅适用于通知所在学校。");
const physics = documented("常州工学院 · 关于参加第十二届全国大学生物理实验竞赛的通知",
  "https://xxgk.czu.cn/2026/0327/c5469a171577/page.htm","2026年全国竞赛三类作品及人数上限，校内报名步骤和遴选名额按学校通知。");
const green = documented("沈阳医学院团委 · 第二届中国青年绿色发展创新大赛通知",
  "https://tw.symc.edu.cn/info/1687/22257.htm","第二届通知记载的产业、公益及行业命题方向；本校组织流程不适用于其他学校。");
const lifeResearch = documented("西安交通大学实践教学中心 · 第十二届全国大学生生命科学竞赛（科学探究类）通知",
  "https://pec.xjtu.edu.cn/info/1117/5536.htm","第十二届科学探究类，2027年赛事通知。校内遴选另行核实。");
const lifeVenture = documented("西南交通大学环境学院 · 全国大学生生命科学竞赛（创新创业类）通知",
  "https://ese.swjtu.edu.cn/info/1961/18231.htm","第十一届创新创业类，2026年全国赛事分组的历史材料；新届成果、署名和队伍条件须重查。");
const ad = documented("全国大学生广告艺术大赛 · 第18届参赛指南",
  "https://www.sun-ada.net/home/about_intrs2.html","第18届全国指南，2026年4月修订。不同作品小类的作者、导师上限各异。");
const design = documented("NCDA组委会 · 2026大赛内容",
  "https://www.ncda.org.cn/dsjs/dsnr/","2026届官方赛道和部分代表性赛项；具体命题、对象与作品规格以对应类别细则为准。");
const building = documented("中国建设教育协会 · 关于举办2026年全国数字建筑创新应用大赛的通知",
  "https://www.ccen.com.cn/info/1150/5937.htm","2026年全国赛三项科目；建筑类相关专业、学段和组队细则须按该届规程核对。");
const energy = documented("东华大学教务处 · 第十三届全国大学生能源经济学术创意大赛通知",
  "https://jw.dhu.edu.cn/2026/1103/c22080a384086/page.htm","第十三届作品类别。本科与研究生按组别报名，东华大学校内安排不推广到别校。");

type Bundle = { doc: Document; tracks: Track[] };
const trackBundles: Record<string, Bundle[]> = {
  "green-development": [{doc:green,tracks:[
    activity("industry-innovation","产业赛道 · 创新组","把实验阶段技术或早期商业计划整理成创新方案，解释适用场景和已有验证。",["research","product"],["product-validation","sustainability-impact"],["prototype","business-plan"]),
    activity("industry-venture","产业赛道 · 创业组","用实际企业项目说明进展、经营模式和发展规划。",["product","accounting-finance","presentation"],["venture-readiness"],["business-plan"],{blockingClarifications:["该组对企业登记时间、适用资质和项目状态有要求，须按该届组别通知核对。"]}),
    activity("public-benefit","公益赛道 · 公益组","围绕本届公益议题调查服务对象的需要，设计可持续的行动方案。",["fieldwork","policy-analysis","writing"],["field-research","sustainability-impact"],["business-plan","presentation"]),
    activity("industry-brief","行业命题赛道 · 行业命题组","针对主办方公布的行业问题分析痛点，比较解决路线和实施条件。",["research","data-analysis","product"],["sustainability-impact","product-validation"],["prototype","business-plan"])
  ]}],
  "information-security":[{doc:security,tracks:[
    activity("open-security-work","作品赛 · 自由作品赛","自行提出信息安全应用场景，开发并演示可测试的软件或硬件作品。",["programming","hardware","research"],["network-systems","software-engineering"],["software","prototype"],{
      stages:{state:"known",values:college}, teamRequirement:maximum(4),requiresFullTime:true,requiresCurrentEnrollment:true,verifiedFacts:["stages","teamRequirement","eligibility"]}),
    activity("security-challenge","作品赛 · 命题挑战赛","选取该届安全挑战题，设计和验证解决方法，并按题目要求提交成果。",["programming","data-analysis","research"],["network-systems","algorithm-competition"],["software","research-paper"],{
      stages:{state:"known",values:university},teamRequirement:maximum(4),verifiedFacts:["stages","teamRequirement"],
      blockingClarifications:["该届通知明确研究生可以参加命题挑战赛。具体题目条件及学籍细则须按组委会命题核实。"]})
  ]}],
  "physics-experiment-innovation":[{doc:physics,tracks:[
    activity("assigned-experiment","命题类创新作品","从公布题目选择实验，做测量或装置验证，说明误差与改进方法。",["laboratory","hardware","data-analysis"],["research-provenance","hardware-build"],["prototype","research-paper"],{teamRequirement:maximum(5),verifiedFacts:["teamRequirement"]}),
    activity("self-directed-experiment","自选课题类创新作品","在自选类要求内提出实验问题，以可复现的测量过程论证结论。",["laboratory","research","data-analysis"],["research-provenance"],["prototype","research-paper"],{teamRequirement:maximum(5),verifiedFacts:["teamRequirement"]}),
    activity("physics-teaching","大学生物理实验讲课比赛","围绕一个物理实验组织教学演示，解释现象、实验步骤和测量依据。",["laboratory","presentation","writing"],["language-communication","research-provenance"],["presentation"],{teamRequirement:maximum(3),verifiedFacts:["teamRequirement"]})
  ]}],
  "culsc-life-sciences":[{doc:lifeResearch,tracks:[
    activity("scientific-inquiry","科学探究类","围绕一个生命科学问题设计并执行研究，保留过程材料，把结果写成论文。",["laboratory","research","data-analysis","writing"],["research-provenance"],["research-paper"])
  ]},{doc:lifeVenture,tracks:[
    activity("biological-innovation","创新创业类 · 创新组","从已形成的创新成果出发，核对本人贡献、成果类型和署名后准备材料。",["laboratory","research","writing"],["research-provenance","product-validation"],["research-paper","prototype"],{blockingClarifications:["该历史届次对可申报成果、署名及贡献顺序有要求，不能把纯想法视为已具备报名条件。"]}),
    activity("biological-venture","创新创业类 · 创业组","梳理生命科学项目的产品、应用对象、团队与可持续经营计划。",["product","accounting-finance","presentation"],["product-validation","venture-readiness"],["business-plan","prototype"],{blockingClarifications:["创业组的团队、成果和报名要求请核对目标届次创新创业类文件。"]})
  ]}],
  "energy-economics-academic-creativity":[{doc:energy,tracks:[
    activity("energy-paper","研究论文类","确定能源经济研究问题，选择数据和研究方法，解释结论的适用范围。",["research","data-analysis","writing"],["modeling-intensive","research-provenance"],["research-paper"]),
    activity("energy-survey","调研报告类","面向实际用能或能源政策问题，收集访谈、问卷或现场证据并提出建议。",["fieldwork","policy-analysis","writing"],["field-research","sustainability-impact"],["research-paper","presentation"]),
    activity("energy-venture","创新创业类","把能源相关方案与具体用户、成本和验证步骤联系起来。",["product","accounting-finance","presentation"],["venture-readiness","product-validation"],["business-plan","prototype"])
  ]}],
  "digital-building-innovation":[{doc:building,tracks:[
    activity("bim-design","BIM数维设计建模赛项","按公建或住宅条件构建模型，检查几何关系和构件表达。",["structural-design","design"],["modeling-intensive"],["prototype"]),
    activity("construction-management","数字施工项目管理综合应用赛项","将施工进度、现场布置和管理任务落实到模型和项目计划。",["structural-design","data-analysis","product"],["modeling-intensive","product-validation"],["prototype","presentation"]),
    activity("quantity-cost","建设工程计量与计价应用赛项","建立计量模型，编制工程量清单并核算招标控制价。",["accounting-finance","structural-design","data-analysis"],["finance-operations","modeling-intensive"],["research-paper","prototype"])
  ]}],
  "future-designer-ncda":[{doc:design,tracks:[
    activity("visual-communication","非命题 · 视觉传达设计","围绕传播对象构建视觉语言，形成可展示的设计作品。",["design","presentation"],["design-portfolio"],["creative-work"]),
    activity("animation-media","非命题 · 动画与数字媒体","用动态视觉与镜头设计表达主题，梳理作品创作过程。",["design","writing"],["design-portfolio","language-communication"],["creative-work"]),
    activity("interaction-design","非命题 · 交互设计","设计用户操作流程，通过样机或演示说明交互决策。",["product","design","programming"],["product-validation","design-portfolio"],["prototype","creative-work"]),
    activity("industrial-design","非命题 · 工业产品设计","把产品用途、结构和造型结合，以设计稿或模型表达方案。",["hardware","design","product"],["hardware-build","design-portfolio"],["prototype","creative-work"]),
    activity("digital-photography","非命题 · 数字摄影","从主题、构图和组照取舍出发形成摄影系列。",["design","fieldwork"],["design-portfolio","field-research"],["creative-work"]),
    activity("digital-sound","非命题 · 数字声音艺术","以声音素材、编辑和结构组织创作可聆听的数字作品。",["design","presentation"],["design-portfolio","language-communication"],["creative-work"])
  ]}],
  "national-advertising-art":[{doc:ad,tracks:[
    activity("graphic","平面类","依命题设计平面广告、包装或创意周边，说明视觉概念。",["design","product"],["design-portfolio"],["creative-work"],{teamRequirement:maximum(2),verifiedFacts:["teamRequirement"]}),
    activity("video","视频类","从策略单写分镜，拍摄剪辑影视、微电影或短视频广告。",["design","writing","presentation"],["language-communication","design-portfolio"],["creative-work"],{blockingClarifications:["短视频与影视、微电影的作者人数上限不同，须核对具体小类。"]}),
    activity("animation","动画类","以角色或动态图形制作广告叙事，说明创意与命题的联系。",["design","writing"],["design-portfolio"],["creative-work"],{teamRequirement:maximum(5),verifiedFacts:["teamRequirement"]}),
    activity("interactive","互动类","设计线上或线下参与机制，演示受众如何与广告内容互动。",["design","product","programming"],["product-validation","design-portfolio"],["prototype","creative-work"],{teamRequirement:maximum(3),verifiedFacts:["teamRequirement"]}),
    activity("audio-ad","广播类","用声音脚本、配音和剪辑在限定时长内完成广告。",["writing","presentation"],["language-communication"],["creative-work"],{teamRequirement:maximum(3),verifiedFacts:["teamRequirement"]}),
    activity("ad-plan","策划案类","从受众洞察提出传播策略，说明执行步骤及创意呈现。",["fieldwork","product","presentation"],["field-research","product-validation"],["business-plan","presentation"],{teamRequirement:maximum(5),verifiedFacts:["teamRequirement"]}),
    activity("copywriting","文案类","围绕品牌命题写创意长文案，打磨受众、叙事与说服理由。",["writing","research"],["language-communication"],["creative-work"],{teamRequirement:maximum(2),verifiedFacts:["teamRequirement"]}),
    activity("interface","UI类","以界面方案呈现核心功能和用户操作路径。",["design","product"],["design-portfolio","product-validation"],["prototype","creative-work"],{teamRequirement:maximum(5),verifiedFacts:["teamRequirement"]}),
    activity("ai-creative","科技类","在对应命题允许的范围内使用生成式AI辅助创作，记录方法和创作过程。",["design","product"],["design-portfolio"],["creative-work"],{teamRequirement:maximum(5),verifiedFacts:["teamRequirement"]})
  ]}],
  "china-college-computer-design":[{doc:computer,tracks:[
    activity("software-development","软件应用与开发","从用户需求出发开发可演示的软件，整理测试与实现说明。",["programming","product"],["software-engineering","product-validation"],["software"]),
    activity("ai-teaching","微课与AI辅助教学","围绕具体学习问题设计教学内容，演示工具如何帮助理解。",["writing","presentation","design"],["language-communication","product-validation"],["creative-work","presentation"]),
    activity("iot","物联网应用","把感知、通信、控制和应用场景连接起来，以原型验证功能。",["hardware","programming"],["hardware-build","network-systems"],["prototype","software"]),
    activity("big-data","大数据应用","处理与分析数据，展示数据应用如何支持具体决策。",["data-analysis","programming"],["modeling-intensive","software-engineering"],["software","research-paper"]),
    activity("applied-ai","人工智能应用","围绕应用任务比较模型效果，记录测试和交付方式。",["programming","research","data-analysis"],["software-engineering","modeling-intensive"],["software","prototype"]),
    activity("info-visualization","信息可视化设计","选择合适的图形和交互，让受众能理解数据或信息的关系。",["design","data-analysis","product"],["design-portfolio","modeling-intensive"],["creative-work","prototype"]),
    activity("static-media","数媒静态设计","通过构图、字体、图像等手段制作围绕当届主题的静态作品。",["design"],["design-portfolio"],["creative-work"]),
    activity("animation-short","数媒动漫与短片","用分镜、动态画面和声音完成短片或动画表达。",["design","writing"],["design-portfolio","language-communication"],["creative-work"]),
    activity("interactive-media","数媒游戏与交互设计","设计玩法或交互流程，制作能体验的作品原型。",["design","programming","product"],["design-portfolio","software-engineering"],["creative-work","prototype"]),
    activity("computer-music","计算机音乐创作","运用数字音乐工具创作或编排声音，解释作品如何回应当届主题。",["design","presentation"],["design-portfolio","language-communication"],["creative-work"]),
    activity("international-sinology","国际生“汉学”","按专项身份和选题要求，通过数字作品表达对中华文化的理解。",["language","research","presentation"],["language-communication"],["creative-work","presentation"],{blockingClarifications:["该类面向国际生，是否具备该专项身份须另核。"]})
  ]}]
};

function maximum(maxSize:number): CompetitionTeamRequirement {
  return {state:"known",mode:"team",minimumSizeUnknown:true,maxSize};
}

export function attachDocumentedTracks(competition: Competition): Competition {
  const bundles = trackBundles[competition.id];
  if (!bundles) return competition;
  const metadata = competition.recommendation;
  const existing = metadata.tracks ?? [];
  const occupied = new Set(existing.map(t => t.id));
  const sources: CompetitionMetadataSource[] = [];
  const additions: Track[] = [];
  for (const [i, {doc,tracks}] of bundles.entries()) {
    const evidenceRef = `tracks:${competition.id}:20261105:${i + 1}`;
    const factual = tracks.some(t => t.verifiedFacts?.length);
    // A school-published account can document named activities. Only an explicitly
    // nationwide clause is tagged as a verified track rule. Campus steps stay in scope text.
    sources.push({url:doc.url,sourceType:doc === computer || doc === design || doc === ad || doc === building ? "organizer" : "education-authority",
      verifiedAt:"2026-11-05",evidenceRef,facts:factual ? ["trackEligibility"] : ["identity"]});
    for (const track of tracks) {
      if (occupied.has(track.id)) throw new Error(`Repeated track ${competition.id}/${track.id}`);
      occupied.add(track.id);
      additions.push({...track, document:doc, evidenceRef});
    }
  }
  let recommendation = {...metadata, tracks:[...existing,...additions], supportingSources:[...(metadata.supportingSources ?? []),...sources]};
  if (competition.id === "china-college-computer-design") {
    const rule:CompetitionMetadataSource = {...sources[0]!, facts:["stages","teamRequirement","trackEligibility"]};
    const enrollment: CompetitionMetadataSource = {url:"https://jsjds.hdu.edu.cn/_upload/article/files/db/e3/f5c061754040b2a70e5b7a844985/c93a5daa-f086-40fc-888c-f08fb062757d.pdf",
      sourceType:"organizer",verifiedAt:"2026-11-05",evidenceRef:"rules:computer-design-2026:full-time-team",facts:["eligibility","stages","teamRequirement"]};
    recommendation = {...recommendation, stages:{state:"known",values:undergraduate},
      teamRequirement:{state:"known",mode:"team",minSize:2,maxSize:9},
      eligibility:{...metadata.eligibility,state:"partial",source:enrollment,requiresCurrentEnrollment:true,requiresFullTime:true,sameInstitutionTeam:true,
        notes:["第19届全国比赛为同校2至9名本科生组队；省级赛推送入围国赛。目标届次有新规则时须另核。"]},
      supportingSources:[...(metadata.supportingSources ?? []),rule,enrollment]};
  } else if (competition.id === "national-advertising-art") {
    const rule:CompetitionMetadataSource = {...sources[0]!,facts:["stages","eligibility","trackEligibility"]};
    recommendation={...recommendation,stages:{state:"known",values:university},eligibility:{...metadata.eligibility,
      state:"partial",source:rule,requiresCurrentEnrollment:true,requiresFullTime:true,
      notes:["第18届指南接受全日制在校大学生和研究生，各类作品的作者人数要求不同。"]},
      supportingSources:[...(metadata.supportingSources ?? []),rule]};
  } else if (competition.id === "information-security") {
    // The parent stage envelope must include every documented eligible track.
    const rule:CompetitionMetadataSource = {...sources[0]!,facts:["stages","trackEligibility"]};
    recommendation = {...recommendation,stages:{state:"known",values:university},
      supportingSources:[...(metadata.supportingSources ?? []),rule]};
  }
  return {...competition,recommendation};
}
