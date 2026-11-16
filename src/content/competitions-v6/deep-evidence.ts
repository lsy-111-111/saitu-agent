import type { CatalogSource, CatalogDeepDive } from "@/lib/competitions/v6/catalog-types";

export type DeepEvidence = {
  source: CatalogSource;
  representativeTask: string;
  title: string;
  origin: CatalogDeepDive["workedExample"]["origin"];
  boundary: string;
  steps: string[];
  checks: string[];
  requirements: { requirement: string; evidence: string }[];
  missing: string[];
};

/** Source descriptions distinguish a brief, a cached excerpt and a university summary from a full work. */
export const deepEvidence: Record<string, DeepEvidence> = {
  "china-college-computer-design": {
    source: { id: "4c-ai-special-task-2026", url: "https://jsjds.sdu.org.cn/listshow/1/39/1/", title: "2026高寻真源软件专项实施方案", publisher: "中国大学生计算机设计大赛济南国赛决赛赛区", authority: "official_host", scope: "2026软件应用与开发内的AI多元场景专项；不能推广为全部软件小类要求", checkedAt: "2026-11-05", publishedAt: "2026-03-17", accessStatus: "excerpt_read", locator: "搜索可读缓存中赛项内容、提交材料、比赛形式、评审标准四节；直接正文多次超时，附件未读", verificationMethod: "agent_web_read" },
    representativeTask: "2026软件类专项要求用至少一种AI技术解决真实场景问题，并在评审时演示系统；这是代表专项，普通软件开发并非都必须用AI。",
    title: "真实命题拆解：2026 AI多元场景应用专项（原网页访问受阻）",
    origin: "official_task",
    boundary: "目前已读官方站搜索缓存中的方案节选，未读附件、未核验完整作品或评分表；下面是要求拆解与编辑提出的验证办法，不是获奖作品复盘。",
    steps: ["先界定一个实际使用者及痛点，确认所选的是这个专项而非相邻的软件小类。", "方案要求AI技术可核验：编辑建议保存模型/API版本、输入输出和功能边界，不用‘用了AI’代替说明。", "方案要求系统演示：编辑建议准备正常输入、异常输入和AI失败三个过程，分别记录结果。", "官方列信息概要和软件设计开发文档等提交材料：附件尚未取得，先做材料索引，不能凭索引宣称完整合规。"],
    checks: ["为何需要AI？无AI基线能否解决同一个问题？", "本人负责的数据、实现或测试有何可追溯记录？", "演示失败时能否解释限制，而非隐去失败样例？"],
    requirements: [{ requirement: "该专项要求至少一种AI技术用于实际场景问题。", evidence: "编辑建议：场景证据、技术选择理由、无AI基线及失败记录。" }, { requirement: "该专项在评审中核验所用技术并要求系统演示。", evidence: "编辑建议：可复现演示、本人代码/测试记录；不推断这些项目各占多少分。" }],
    missing: ["赛区正文直接访问多次超时，目前仅官方搜索缓存节选，须补原文及附件逐项核验", "没有完整公开作品及可适用的国赛细项评分表，不能冒充优秀作品分析", "待真实人工内容审核与独立学生理解评审"]
  },
  "market-research-analysis": {
    source: { id: "market-cau-case-2026", url: "https://news.cau.edu.cn/zhxwnew/0cc5abbfa15143bfa22615c8ded2e0c6.htm", title: "中国农业大学第16届市调大赛公开项目摘要", publisher: "中国农业大学新闻中心", authority: "university_local", scope: "2026第16届该校公开作品摘要；不支持第17届资格或评分规则，也不是完整报告与数据", checkedAt: "2026-11-05", publishedAt: "2026-06-24", accessStatus: "body_read", locator: "项目介绍：北京市高校学生漂亮饭消费行为与付费意愿，正文最后一项", verificationMethod: "agent_web_read" },
    representativeTask: "公开案例研究北京市大学生餐饮消费，使用问卷、访谈与分析考察付费意愿；目标是向食堂和轻食经营者提出有依据的建议。",
    title: "真实作品摘要拆解：北京市大学生‘漂亮饭’消费调查（第16届）",
    origin: "published_summary",
    boundary: "只取得学校公开摘要，未取得原问卷、数据、模型和完整报告。以下问题用于学习如何检验研究，不能断言原团队确实采取了某种抽样或已证明因果。",
    steps: ["摘要明确研究人群与消费问题：编辑分析应先分清‘买不买’、‘愿付多少’与实际购买行为。", "摘要提到问卷与访谈：编辑建议查看问题如何避免引导、访谈如何帮助修订量表；原题项未公开，不能代写成原团队做法。", "摘要提到实证分析但无数据细节：需追问样本覆盖、无效回答规则与偏差，不能从获奖称号推导结论可靠。", "摘要面向经营者提出建议：编辑建议用结论—证据—适用人群表检查，每条建议注明相关性与因果的区别。"],
    checks: ["谁没有被样本覆盖，结论能否推广到他们？", "付费意愿是否等于实际交易，怎样验证差别？", "没有原始材料时，哪些判断必须保持未知？"],
    requirements: [],
    missing: ["学校仅公开作品摘要，没有原问卷、数据和完整报告，不能完成方法与结果复核", "第17届本科实践赛组委会评分细则仍待原文；不借用研究生组或往届权重", "待真实人工内容审核与独立学生理解评审"]
  },
  "national-advertising-art": {
    source: { id: "advertising-aliyun-brief-2026", url: "https://www.sun-ada.net/home/zt_xqs3026.html", title: "第18届阿里云命题详情", publisher: "全国大学生广告艺术大赛官网", authority: "organizer", scope: "第18届阿里云品牌命题的平面类；品牌宣传描述不是客观产品能力或其他命题要求", checkedAt: "2026-11-05", publishedAt: null, accessStatus: "body_read", locator: "目标群体、广告目的、创作须知、广告形式第一项；正文企业奖段落明确第18届", verificationMethod: "agent_web_read" },
    representativeTask: "以第18届阿里云命题为例，选择一种目标受众，用平面作品解释大模型与AI应用场景的关系；自行提出传播语，并遵守该命题指定的AI创作要求。",
    title: "真实命题拆解：第18届阿里云平面广告（不等于获奖范作）",
    origin: "official_task",
    boundary: "官方命题正文已读；这里分析创作目标和交付约束，没有查看素材网盘和获奖原稿。品牌自述的能力和领先程度不能改成已验证产品事实。",
    steps: ["命题列不同受众：先选择技术决策者、内容创作者或科技兴趣者中的一个，避免一张图同时面向所有人。", "把抽象技术换成一个明确使用场景，区分已确认产品能力、命题方宣传与编辑构想，不编造效果承诺。", "按平面命题准备A3竖版JPG及自行创作的传播语；用三张草图比较信息层级，再核对通用参赛指南。", "按此命题要求记录指定AI工具参与的环节，保留原始输出、本人修改和素材出处；不能由此推断全部品牌命题均强制AI。"],
    checks: ["观看者能否说出品牌与场景的关系，而非只看到科幻画面？", "宣传信息属于品牌自述、事实还是未来设想？", "本人创意与AI输出的边界能否说明？"],
    requirements: [{ requirement: "阿里云平面命题指定A3竖版JPG，并要求作品体现自行创作的传播语。", evidence: "编辑建议：文件尺寸/格式清单、传播语备选稿与受众理解测试。" }, { requirement: "该品牌命题要求在创作中使用千问系列及配套工具。", evidence: "编辑建议：工具使用记录、素材授权与个人修改过程；这是命题约束，并非全国统一评分权重。" }],
    missing: ["素材包和完整公开参赛作品未取得，不能评价素材授权或原稿制作质量", "已读创作要求并不提供统一评分权重；适用官方评审细则待补", "待真实人工内容审核与独立学生理解评审"]
  }
};
