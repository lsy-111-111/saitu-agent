import { authoredDeepCase, type ResearchedContent } from "./research-types";

export const historicalSoftwareBatch04: ResearchedContent[] = [
  { ...{
  "seriesId": "google-code-jam",
  "name": "Google Code Jam",
  "organizer": "Google",
  "aliases": [],
  "authorAgentId": "/root",
  "editionId": "2022",
  "edition": "2022历史题；系列已于2023结束",
  "groupId": "historical-public-task",
  "group": "历史正式题学习，不提供当前报名资格判断",
  "scopeId": "qualification-3d-printing-2022",
  "scope": "Qualification Round：3D Printing；历史规则边界另列",
  "origin": "verified_expansion",
  "trackId": "qualification-3d-printing",
  "trackName": "Qualification Round：3D Printing",
  "taskFamily": "software-algorithms",
  "subjectDomains": [
    "engineering",
    "science"
  ],
  "factStatus": "historical",
  "registrationStatus": "historical",
  "registrationNote": "Google官方2023告别公告明确赛事结束，现存官方归档供题目学习；不推荐当届报名，不计近期正式参与覆盖。",
  "sources": [
    {
      "id": "gcj-2022-3d-task",
      "url": "https://github.com/google/coding-competitions-archive/blob/main/codejam/2022/qualification_round/3d_printing/statement.pdf",
      "title": "2022资格赛3D Printing完整官方题",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "完整2页：四墨盒整数容量、输入输出、5秒/1GB及三个完整样例",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    },
    {
      "id": "gcj-2022-3d-analysis",
      "url": "https://github.com/google/coding-competitions-archive/blob/main/codejam/2022/qualification_round/3d_printing/analysis.pdf",
      "title": "3D Printing官方分析",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "完整1页：逐色最小容量与总和不变量",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    },
    {
      "id": "google-competitions-farewell",
      "url": "https://developers.googleblog.com/celebrate-googles-coding-competitions-with-a-final-round-of-programming-fun/",
      "title": "Google Coding Competitions正式告别及归档公告",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "赛事结束、2023年4月15日最后活动、官方GitHub归档说明",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    }
  ],
  "eligibilityFacts": [
    {
      "idSuffix": "historical-rules",
      "text": "2022年龄、地域及雇佣关系等完整资格条款未取得；公开读题不证明历史或当前参赛资格。",
      "sourceIds": [],
      "scope": "2022历史报名资格资料缺口；仅供公开题学习，不确认历史或当前报名条件",
      "kind": "unknown",
      "status": "unknown"
    }
  ],
  "eligibilityRules": [
    {
      "id": "google-code-jam-past-eligibility",
      "field": "priorQualification",
      "operator": "requires_confirmation",
      "value": "历史届次完整参赛条款未核；当前系列已结束",
      "factIds": [
        "google-code-jam:v2:eligibility.historical-rules"
      ],
      "note": "未知保持unknown；公开题学习不等于报名合格。"
    }
  ],
  "verified": {
    "eligibility": {
      "text": "Google官方告别公告明确结束Coding Competitions，并将题面、分析及测试数据持续保留在官方GitHub归档。",
      "source": 2
    },
    "track": {
      "text": "给定三台打印机的青、品红、黄、黑四墨盒容量，找能由三台机器分别打印同色的四个非负整数用量，总和必须恰为100万；无解输出IMPOSSIBLE。",
      "source": 0
    },
    "participation": {
      "text": "2022资格赛该题采用标准输入输出，按测试用例输出Case #x结果；原题允许多解任取，不要求真的制作打印机或购买墨盒。",
      "source": 0
    },
    "deliverables": {
      "text": "每例读入3行4个容量；输出四个整数或IMPOSSIBLE。容量在0至100万，测试用例至多100；题定时间5秒、内存1GB。",
      "source": 0
    },
    "rubric": {
      "text": "官方题的正确性判定要求四用量分别不超过每台打印机对应容量、非负且和恰为100万；多种合法结果均接受，唯一测试集标Visible Verdict。没有取得该题分值，不编造分数。",
      "source": 0
    }
  },
  "task": "从共享资源约束提炼逐维上限，构造满足等式的可行解，并证明无解条件。",
  "roles": [
    {
      "name": "独立约束建模与实现",
      "task": "将三台容量压缩成四个最小值，证明可行条件并实现构造",
      "skills": [
        "programming",
        "mathematics"
      ],
      "evidence": "为什么总容量足够就是充分条件，而不是只必要？",
      "output": "本人不变量证明、代码和边界测试"
    }
  ],
  "gain": "形成从文字约束到算法不变量的完整证据；历史公开题练习不产生赛事成绩或证书。",
  "entry": "会数组、循环、整数比较和标准输入输出即可开始；重点是区分每台机器容量与三台总和。",
  "completion": "样例通过不够，需同时证明解的非负性、逐色上界与精确总和；额外加大用量即使未超墨盒也可能使答案无效。",
  "investment": "编辑建议四周每周2—4小时；本地电脑与离线编程工具即可完成此题分析。历史赛事个人完整费用未知，题目中的墨水是输入数据，不是采购预算。",
  "fit": [
    "喜欢短小但可证明的算法",
    "愿意按约束检查多解"
  ],
  "avoid": [
    "只想背样例输出",
    "希望拿已结束赛事作为当前报名机会"
  ],
  "trial": {
    "action": "选择或自行构造一组输入，列出逐色容量表，逐项核对自己的输出与题面约束，并记录演算过程。",
    "output": "最小容量表与一份逐约束核验单",
    "check": "能用自己的逐色容量表解释输出结果；若与题面约束不一致，能指出并修正。",
    "reflection": "你更擅长找约束、写构造还是发现漏掉的等式？"
  },
  "remaining": [
    "完整2022年龄/地域等资格条款与历史个人费用未核；当前已停办",
    "归档的旧评测环境不可据本机运行假装已复现；不承诺任何历史名次"
  ]
}, deepCase: authoredDeepCase({
  "seriesId": "google-code-jam",
  "task": "2022 Code Jam资格赛3D Printing完整题：三台四墨盒容量，构造共同可打印且总用量100万的颜色。",
  "title": "从十二个容量到四个上界：可行条件与构造",
  "sourceIds": [
    "gcj-2022-3d-task",
    "gcj-2022-3d-analysis",
    "google-competitions-farewell"
  ],
  "boundary": "已读取Google官方归档的完整题、官方分析及图示。样例数据、判定约束是原题；下述前向分配写法是与官方削减法等价的编辑推导。仅历史学习，不称现行竞赛，不代填缺失分值或全程费用。",
  "steps": [
    "按列取三台机器的最小值。第一例得到300000、200000、300000、200000，和恰为100万；这四值就是该例唯一解。",
    "若四上限之和小于100万，任何用量总和均不可能达标。第二例只有品红共同非零且上限999999，因此无解。",
    "若总上限足够，按颜色分配min(该色上限,剩余需求)，每步减少需求；四种处理后需求必为0。写出剩余容量覆盖剩余需求的不变量，并与官方逐色削减分析比较。",
    "第三例允许多解：逐约束检验输出，不用与样例做字符串完全相等。补全0容量、全部100万和总和恰差1的边界；记录本机运行结果而不冒官方判题。"
  ],
  "questions": [
    "三台对应墨盒为何取最小值而不是求和？",
    "各色均不超上限却总量超过100万，是否有效？",
    "怎样测试允许多解的程序而不误报？"
  ],
  "rubrics": [
    [
      "四颜色容量与恰好100万",
      "逐项断言非负、每台上界和总和；无解时给上限和证明。"
    ],
    [
      "题定输入输出与资源限制",
      "批量样例格式和O(1)额外空间检查；本机计时不当官方成绩。"
    ]
  ],
  "roles": [
    {
      "role": "独立实现者",
      "steps": [
        "提炼上界",
        "证明构造",
        "写多解校验与边界"
      ],
      "contributionProof": "个人推导、代码、失败用例及修订"
    }
  ],
  "weeks": [
    [
      "重建三台约束和三个样例",
      "表格逐项对应输入而不是只抄输出"
    ],
    [
      "证明必要充分条件并实现构造",
      "能解释每一步剩余需求"
    ],
    [
      "写多解校验和边界对拍",
      "三个官方样例与零容量、总上限恰差1的边界均通过逐项断言；保留多解校验结果和失败反例。"
    ],
    [
      "独立重写并复盘一个错误解",
      "证明与代码一致且明确历史边界"
    ]
  ],
  "exits": [
    "无法读懂输入维度时先停在手算样例",
    "需要当前报名时另选有当前规则的赛事，不能使用本历史条目"
  ]
}) },
  { ...{
  "seriesId": "google-kick-start",
  "name": "Google Kick Start",
  "organizer": "Google",
  "aliases": [],
  "authorAgentId": "/root/continue_catalog",
  "editionId": "2022",
  "edition": "2022历史题；系列已于2023结束",
  "groupId": "historical-public-task",
  "group": "历史正式题学习，不提供当前报名资格判断",
  "scopeId": "round-a-speed-typing-2022",
  "scope": "Round A：Speed Typing；历史规则边界另列",
  "origin": "verified_expansion",
  "trackId": "round-a-speed-typing",
  "trackName": "Round A：Speed Typing",
  "taskFamily": "software-algorithms",
  "subjectDomains": [
    "engineering",
    "science"
  ],
  "factStatus": "historical",
  "registrationStatus": "historical",
  "registrationNote": "Google官方2023告别公告明确赛事结束，现存官方归档供题目学习；不推荐当届报名，不计近期正式参与覆盖。",
  "sources": [
    {
      "id": "gks-2022-speed-task",
      "url": "https://github.com/google/coding-competitions-archive/blob/main/kickstart/2022/round_a/speed_typing/statement.pdf",
      "title": "2022 Round A Speed Typing完整题",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "完整2页：仅删除、大小写、两测试集与四组样例",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    },
    {
      "id": "gks-2022-speed-analysis",
      "url": "https://github.com/google/coding-competitions-archive/blob/main/kickstart/2022/round_a/speed_typing/analysis.pdf",
      "title": "Speed Typing官方分析",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "完整2页：子序列判定和双指针伪代码",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    },
    {
      "id": "google-competitions-farewell",
      "url": "https://developers.googleblog.com/celebrate-googles-coding-competitions-with-a-final-round-of-programming-fun/",
      "title": "Google Coding Competitions正式告别及归档公告",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "赛事结束、2023年4月15日最后活动、官方GitHub归档说明",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    }
  ],
  "eligibilityFacts": [
    {
      "idSuffix": "historical-rules",
      "text": "2022年龄、地域及雇佣关系等完整资格条款未取得；公开读题不证明历史或当前参赛资格。",
      "sourceIds": [],
      "scope": "2022历史报名资格资料缺口；仅供公开题学习，不确认历史或当前报名条件",
      "kind": "unknown",
      "status": "unknown"
    }
  ],
  "eligibilityRules": [
    {
      "id": "google-kick-start-past-eligibility",
      "field": "priorQualification",
      "operator": "requires_confirmation",
      "value": "历史届次完整参赛条款未核；当前系列已结束",
      "factIds": [
        "google-kick-start:v2:eligibility.historical-rules"
      ],
      "note": "未知保持unknown；公开题学习不等于报名合格。"
    }
  ],
  "verified": {
    "eligibility": {
      "text": "Google官方告别公告明确结束Coding Competitions，并将题面、分析及测试数据持续保留在官方GitHub归档。",
      "source": 2
    },
    "track": {
      "text": "已知目标字符串I和实际输入P，只允许从P删除字符，判断能否得到I；能则输出删除数，不能则IMPOSSIBLE，字符大小写有区别。",
      "source": 0
    },
    "participation": {
      "text": "正式Round A题按多组输入计算结果，不是Coding Practice活动。先处理目标全同字符的测试集，再处理任意大小写字母串。",
      "source": 0
    },
    "deliverables": {
      "text": "每例输出Case #x加删除数或IMPOSSIBLE；T至多100，字符串长1至10万，内存1GB。测试集1限20秒且I字母全同，测试集2限40秒。",
      "source": 0
    },
    "rubric": {
      "text": "答案必须满足仅删除且保序，不能替换、插入或忽略大小写。两个测试集的范围与时限明确；样例正确不代替全部测试。未取得分值，不自定权重。",
      "source": 0
    }
  },
  "task": "把输入修复故事转成子序列问题，用双指针保持顺序并证明删除次数唯一。",
  "roles": [
    {
      "name": "独立字符串算法",
      "task": "区别删除、替换和重排，建立双指针不变量并验证边界",
      "skills": [
        "programming",
        "mathematics"
      ],
      "evidence": "字符计数相同为什么仍可能无解？",
      "output": "双指针跟踪表、个人代码及顺序反例"
    }
  ],
  "gain": "能展示条件抽象、线性复杂度分析与反例设计；练习不等于通过官方赛程。",
  "entry": "需理解字符串下标与循环条件，新手可先用纸笔划掉多余字符。",
  "completion": "难点是保序而非字符数量；必须检查目标指针最终到达末尾，并在读取字符前防止越界。",
  "investment": "编辑建议四周每周2—3小时，已有电脑和本地语言运行环境即可读题实现；历史正式报名及个人全程费用未知，当前赛事已结束。",
  "fit": [
    "喜欢从反例澄清算法条件",
    "想练线性扫描与证明"
  ],
  "avoid": [
    "认为大小写或字符顺序可以随意改动",
    "需要当前正式报名名额"
  ],
  "trial": {
    "action": "选择或自行构造几组目标字符串和输入字符串，逐步记录保留或删除的位置，再检查是否满足题面约束。",
    "output": "指针步进表、删除数量与无解理由",
    "check": "能用自己的步进表解释输出结果；若发现不一致，保留核对与修正记录，未发现时说明检查过哪些情形。",
    "reflection": "你能在写代码前解释每次指针移动的含义吗？"
  },
  "remaining": [
    "完整历史资格与费用条款未核；当前不提供报名",
    "官方归档中的旧测试时限是历史评测条件，不作本机性能保证"
  ]
}, deepCase: authoredDeepCase({
  "seriesId": "google-kick-start",
  "task": "2022 Kick Start Round A Speed Typing：通过删除P中的字符得到I，输出删除数或IMPOSSIBLE。",
  "title": "计数为何不够：用双指针保住顺序",
  "sourceIds": [
    "gks-2022-speed-task",
    "gks-2022-speed-analysis",
    "google-competitions-farewell"
  ],
  "boundary": "完整官方题和官方分析均已读；选择正式Round A而非练习场，保留不同测试集限制。以下是原题双指针证明的学习解释，不编造题目分值、名次或当届资格。",
  "steps": [
    "先看仅删除规则：若可行，删除数必为|P|-|I|；但长度差非负本身不证明可行。原题aaaa/aaaaa可删1，bbbbb/bbbbc缺一个b则无解。",
    "令i指向I首个未匹配字符，j扫描P；相等时两个指针推进，不等只推进j。已匹配的I前缀始终能由已扫P前缀删除得到。",
    "终止时i达到|I|才可输出长度差。原例Ilovecoding/IIllovecoding可删2；KickstartIsFun/kkickstartiisfun缺大写K，所以无解。",
    "对照官方O(|P|)时间与O(1)额外空间分析；用顺序反例、大小写、P更短、全匹配及连续冗余字符验证，不用排序或集合计数替代保序判断。"
  ],
  "questions": [
    "为什么找到更早的匹配字符不会损害后续可行性？",
    "I=ab和P=ba的字符数量相同，为何无解？",
    "什么时候才能输出长度差而不是提前断言成功？"
  ],
  "rubrics": [
    [
      "仅删除且保序的正确输出",
      "可行分支给完整匹配轨迹，无解指出未匹配目标，大小写原样处理。"
    ],
    [
      "两测试集与时限",
      "从单字符计数推广到线性双指针；实际代码不做二次方删除。"
    ]
  ],
  "roles": [
    {
      "role": "独立求解者",
      "steps": [
        "手算原例",
        "证明贪心匹配",
        "实现并构造反例"
      ],
      "contributionProof": "本人不变量、代码和错误修订"
    }
  ],
  "weeks": [
    [
      "按原题操作手算四样例",
      "没有引入插入/替换"
    ],
    [
      "写双指针和终止条件",
      "每次移动有明确含义"
    ],
    [
      "构造顺序与大小写反例",
      "不以字符计数假装一般解"
    ],
    [
      "限时独立重建并写复杂度说明",
      "正确性与代码可交叉检查"
    ]
  ],
  "exits": [
    "下标越界未修复时先退回跟踪表",
    "若需要当前参赛结果，另选仍开放且规则已核的系列"
  ]
}) },
  { ...{
  "seriesId": "google-hash-code",
  "name": "Google Hash Code",
  "organizer": "Google",
  "aliases": [],
  "authorAgentId": "/root/continue_catalog",
  "editionId": "2022",
  "edition": "2022历史题；系列已于2023结束",
  "groupId": "historical-public-task",
  "group": "历史正式题学习，不提供当前报名资格判断",
  "scopeId": "qualification-mentorship-2022",
  "scope": "Qualification Round：Mentorship and Teamwork；历史规则边界另列",
  "origin": "verified_expansion",
  "trackId": "qualification-mentorship",
  "trackName": "Qualification Round：Mentorship and Teamwork",
  "taskFamily": "software-algorithms",
  "subjectDomains": [
    "engineering",
    "science"
  ],
  "factStatus": "historical",
  "registrationStatus": "historical",
  "registrationNote": "Google官方2023告别公告明确赛事结束，现存官方归档供题目学习；不推荐当届报名，不计近期正式参与覆盖。",
  "sources": [
    {
      "id": "ghc-2022-mentorship-task",
      "url": "https://github.com/google/coding-competitions-archive/blob/main/hashcode/hashcode_2022_qualification_round.pdf",
      "title": "Hash Code 2022 Mentorship and Teamwork完整任务",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "完整9页：角色、导师机制、技能增长、输入输出及33分例",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    },
    {
      "id": "ghc-2022-event",
      "url": "https://blog.google/innovation-and-ai/technology/developers-tools/hash-code-2022-returns-new-look/",
      "title": "Google Hash Code 2022官方赛事介绍",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "2—4人真实参赛团队、2月23日注册截止与2月24日资格赛",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    },
    {
      "id": "google-competitions-farewell",
      "url": "https://developers.googleblog.com/celebrate-googles-coding-competitions-with-a-final-round-of-programming-fun/",
      "title": "Google Coding Competitions正式告别及归档公告",
      "publisher": "Google（官方竞赛归档）",
      "scope": "2022已结束赛事的历史题与判定依据；不构成当前报名机会",
      "locator": "赛事结束、2023年4月15日最后活动、官方GitHub归档说明",
      "publishedAt": null,
      "checkedAt": "2026-11-06",
      "retrievedAt": "2026-11-06",
      "accessStatus": "body_read",
      "authority": "organizer",
      "verificationMethod": "agent_web_read",
      "integrity": "consistent",
      "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json"
    }
  ],
  "eligibilityFacts": [
    {
      "idSuffix": "historical-rules",
      "text": "2022年龄、地域及雇佣关系等完整资格条款未取得；公开读题不证明历史或当前参赛资格。",
      "sourceIds": [],
      "scope": "2022历史报名资格资料缺口；仅供公开题学习，不确认历史或当前报名条件",
      "kind": "unknown",
      "status": "unknown"
    }
  ],
  "eligibilityRules": [
    {
      "id": "google-hash-code-past-eligibility",
      "field": "priorQualification",
      "operator": "requires_confirmation",
      "value": "历史届次完整参赛条款未核；当前系列已结束",
      "factIds": [
        "google-hash-code:v2:eligibility.historical-rules"
      ],
      "note": "未知保持unknown；公开题学习不等于报名合格。"
    },
    {
      "id": "ghc-team-min",
      "field": "teamSize",
      "operator": "min",
      "value": 2,
      "factIds": [
        "google-hash-code:v2:eligibility"
      ],
      "note": "官方2022资格赛队伍至少2人，不是题目中的贡献者数量。"
    },
    {
      "id": "ghc-team-max",
      "field": "teamSize",
      "operator": "max",
      "value": 4,
      "factIds": [
        "google-hash-code:v2:eligibility"
      ],
      "note": "官方2022资格赛队伍至多4人。"
    }
  ],
  "verified": {
    "eligibility": {
      "text": "Google 2022赛事介绍要求资格赛真实参赛队伍由2—4人组成；此处是现实参赛队伍人数，不是题目中的contributors或mentor角色。",
      "source": 1
    },
    "track": {
      "text": "给定贡献者技能与项目角色、工期、分数及best-before日，安排人员完成项目以提高总分；差一级可由同项目其他已分配角色的合格贡献者辅导，项目结束可能提升技能。",
      "source": 0
    },
    "participation": {
      "text": "2022真实团队注册截止2月23日，资格赛2月24日举行；题目内需对不同数据集生成调度结果，参赛可多次提交解。",
      "source": 1
    },
    "deliverables": {
      "text": "ASCII文本首行为已执行项目数，随后每项目两行：项目名与按角色顺序的贡献者名。每项目至多一次，同一人在一个项目至多一个角色，同时不能参加两个项目。",
      "source": 0
    },
    "rubric": {
      "text": "若角色分配无效则整份提交无分。项目在人员均空闲时立即开始；完成时点晚于best-before每晚一天扣1分，最低0。单数据集求项目分数和，最终取各数据集最佳分数之和；官方样例为33分。",
      "source": 0
    }
  },
  "task": "实现可核查的项目调度和技能成长模拟，再比较可行策略的分数，不把启发式结果说成最优。",
  "roles": [
    {
      "name": "约束与评分实现",
      "task": "按人员可用时间和技能验证安排，用自己的事件表核对评分计算",
      "skills": [
        "programming",
        "mathematics"
      ],
      "evidence": "为什么先做WebServer后Anna才能执行Logging？",
      "output": "独立调度验证器、逐事件技能与分数日志"
    },
    {
      "name": "策略与对照实验",
      "task": "比较不同项目排序和导师组合，保留失败及得分变化",
      "skills": [
        "programming",
        "data-analysis"
      ],
      "evidence": "得分上升是否来自同一输入与同一评分器？",
      "output": "策略版本、同条件分数表与局限说明"
    }
  ],
  "gain": "形成约束模拟、优化实验和可追溯分工证据；真实题中的团队合作不保证现实竞赛或招聘收益。",
  "entry": "可先用纸笔演算自己构造的小规模人员与项目安排，再尝试字典、排序和事件模拟；是否深入复杂搜索，可根据实际体验决定。",
  "completion": "评分器正确是前提；在有效性、迟到扣分与技能增长都准确后，才有意义比较启发式策略，不能凭一次高分宣布全局最优。",
  "investment": "编辑建议四周每周4—6小时先做小样例和本地模拟；大型数据的算力时间需另估，历史个人正式成本未知，当前赛事已停办。",
  "fit": [
    "愿意先验证约束再优化",
    "喜欢用可复算实验比较策略"
  ],
  "avoid": [
    "把题内导师要求当现实教师门槛",
    "不能接受启发式没有最优保证"
  ],
  "trial": {
    "action": "选择或自行构造一组人员、技能和项目数据，手算一种项目安排，记录开始、结束、人员占用、技能变化与得分。",
    "output": "项目安排事件表及评分复算记录",
    "check": "能用自己的事件表说明安排、人员占用与评分计算；出现不一致时标出待查步骤，核对后保留修正记录。",
    "reflection": "你更喜欢实现严谨评分，还是研究改变顺序的收益？"
  },
  "remaining": [
    "2022完整年龄/地域条款和个人全部费用未核；不做当前报名推荐",
    "只复核完整题及官方样例，未声称复现大规模历史排行榜；新策略须真实运行"
  ]
}, deepCase: authoredDeepCase({
  "seriesId": "google-hash-code",
  "task": "Hash Code 2022正式资格赛Mentorship and Teamwork完整9页任务；以三人三项目完整官方样例追踪33分。",
  "title": "先复算33分，再谈调度优化",
  "sourceIds": [
    "ghc-2022-mentorship-task",
    "ghc-2022-event",
    "google-competitions-farewell"
  ],
  "boundary": "已读完整题、输入输出例、技能/导师与评分图表。题内贡献者和导师是模拟数据，不是现实参赛者资格。本稿不提供榜单成绩，不认为官方示例是最优；最后各数据集最佳分数的汇总不能和单项目分数混淆。",
  "steps": [
    "按原例建立Anna的C++2、Bob的HTML5/CSS5和Maria的Python3，录入Logging、WebServer、WebChat三项目。缺失技能按0；允许低一级必须同项目另一角色的人实际达到该技能要求。",
    "先执行WebServer，Bob与Anna从第0天工作到第6天，第7天空闲；Anna C++由2升3，Bob角色要求低于原等级不提升。不能在项目启动时提前升级技能。",
    "Logging由Anna第7天开始、第12天完成，得10-(12-5)=3分；WebChat由Maria和Bob第7天开始、第17天完成且不迟到，得20分。与WebServer10分相加为33。",
    "为验证器加入重复项目、一人兼多个角色、无合格导师和人员时间冲突等反例；再设计不同项目排序并以同一评分器比较。零分项目仍占工期且可升级，不能直接从状态模拟删掉。"
  ],
  "questions": [
    "完成日12与最后工作日11怎样共同决定迟到7天？",
    "导师能否只在项目外出现，或仅靠自己辅导自己？",
    "为何零分项目仍可能改变后续可行性？"
  ],
  "rubrics": [
    [
      "合法分配优先于任何得分",
      "角色顺序、技能/导师条件、人员可用时间和项目唯一性全部检查；违规不计分。"
    ],
    [
      "迟到惩罚与跨数据集汇总",
      "复算33分并记录完成日；单数据集项目分数和与各数据集最佳分数汇总分开。"
    ]
  ],
  "roles": [
    {
      "role": "验证器作者",
      "steps": [
        "实现角色校验",
        "模拟完成与升级",
        "复算原例和无效例"
      ],
      "contributionProof": "个人代码及逐事件核验记录"
    },
    {
      "role": "优化实验者",
      "steps": [
        "定义基线排序",
        "改变一个策略",
        "同条件复算分数"
      ],
      "contributionProof": "本人策略差异、运行结果和失败解释"
    }
  ],
  "weeks": [
    [
      "手算完整三项目例",
      "复现开始结束、技能和33分"
    ],
    [
      "实现确定性验证与评分器",
      "捕获无效分配及重复项目"
    ],
    [
      "提出两种排序策略并比较",
      "同输入同评分器且不宣称最优"
    ],
    [
      "整理复杂度、结果与个人分工",
      "所有分数来自可复算输出"
    ]
  ],
  "exits": [
    "样例复算不一致时停止优化，先修评分器",
    "缺少算力时缩小公开学习样例，不把小例结果外推正式大数据排名"
  ]
}) },
];
