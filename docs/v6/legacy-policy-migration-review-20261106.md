# 旧 gold 与五维政策的迁移候选审查

本文件是可复跑的迁移审查包，**待独立复审，不是迁移批准或正式验收**。原 gold 判断与质量阈值均保留，没有改写旧 gold，没有将当前 TopK 写为答案。前瞻基线另以 v2 记录真实结果，旧 exact3／subset 质量门槛迁至独立测试继续执行。旧 96 评分对、44/28/24 标签分布、40 条理由样例、104 条机械展开关系、90% 原区间门槛、36 追问与 75 字面分支全部保留。

## 冻结与信任边界

`artifacts/continuation-20261105/legacy-migration/before/` 保存开始修改前的 34 份实际字节，包括原 manifest、全部已冻结 gold／verifier／toolchain、原 prospective 和 `full-vitest-01.json`。原报告为 **1207 pass / 14 fail / 61 environment skip**，不是本轮测试结果。`before-lock.json` 固定所有字节；原 manifest SHA 为 `12e55abd85d6c80e55379bb30ea597d85f33c771bce8283538f0f0e7bd481fb7`。

原 manifest 中已有 **10 处** byte drift，完整记录见 `original-freeze-drift.json`。原校验首先停在 quality-benchmark，不能据此推断只有一处漂移。本轮只新增独立冻结保护，不修改原 manifest 或替它批准已变更文件。仓内清单只能形成可审内容地址，最终信任仍须由外部发布记录绑定独立审查后的根 SHA。

## 盲评方法审查

独立盲评锁 SHA 为 `8958065fdf8d7e10a44df87a9d62a25ad94dd5508055c422a1cd6e66ed946379`。该评审未读实现输出／旧答案；本轮校验其输入 SHA、所有文件 SHA 和标签逐项来源。它是一份 **AI 语义分组表加脚本展开**，不是每行独立人工审查，不应称 human-approved gold。语义分组按已阅画像和候选摘要建立，再由案例类型展开，因此同组行之间不是独立判断样本。

该方法足以提供覆盖完整候选池的任务相关性建议和需要补事实的清单；不足以单独批准旧综合分数、精确名次、可报名资格或数值阈值迁移：

- 96 对的个人贡献都缺事实，独立评审明确保留 0–20 未知范围。兴趣、技能自述和项目／奖项类别不能证明本人完成任务。
- 总分宽区间是规范性可能范围，不是统计置信区间。脚本的 goal／growth 范围主要随任务相关性分档，不能据此证明旧窄区间失效或构造新的精确分数 gold。
- 72 条新关系全部是 **任务维度** 的关系；它们对应原 104 条中的 72 条，但不能证明五维综合顺序。其余 32 条没有相应新关系，不得补造。
- 资格取自指定兼容目录，未重新抓取官方原文；目录内部冲突、时效／费用／人数未知仍未裁定。完整池任务标签不能覆盖硬门槛。
- 25 排名画像均已有项目／奖项类别；不能代表真实新手覆盖。
- 分支的候选例子与偏好约束不构成全局排序承诺；缺竞争强度或学校认定事实时，“award”不能被解释为更容易获奖或获得校内认定。

新版 `tests/fixtures/competition-legacy-policy-advisory-v1.json` 明确标识 `humanApproved:false`、`replacesHistoricalAcceptance:false`。标签在运行应用前来自锁定评审：25×135 排名、18×135 旧 v4、36×135 追问基线，没有只标当前返回的候选。

## 原 14 失败逐项处理

完整原始失败文本与剩余要求见 `failure-mapping.json`；这里仅列审查结论。

| ID | 原失败保护 | 证据与新增保护 | 当前结论 |
|---|---|---|---|
| L01 | 轨道问答在真实 V5 路径 <=3 轮可达且分支可见差异 | 7 条路径未达目标；AI 分支语义不决定问答调度 | 保留原失败；需逐路径合法性与必要性审查 |
| L02 | 每个问题可问、实质且分支结果不同 | 3 个 prior fit 不在选项白名单，goal-10 不可问 | 保留；不能按当前选项反写前置答案 |
| L03 | fit／goal 最小成员、相对顺序、轨道 | 新完整池只有任务语义和条件约束，无综合精确名次 | 保留；精确迁移被缺事实阻塞 |
| L04 | 完整池资格不随偏好改变 | 新增全部 51 个字面 fit／goal 分支直接重放，逐候选核对预计算资格 | 新增底层验证；不替代原可达性门槛 |
| L05 | goal 只改许可分量，旧 75/25 公式 | 已授权五维目标权重 30；新增 24 目标分支的任务不变时非目标分量隔离及 award 未知保护 | 公式版本迁移候选，待独立审；原公式断言仍在 |
| L06 | 轨道来自预计算状态，不能升级 needs_clarification | 同 7 条前置路径未到达；资格政策未失效 | 保留；仍须真实 reached-track 验证 |
| L07 | gold／verifier／toolchain 字节与外部根 | 34 旧文件冻结、10 原漂移明细、独立盲评与新 fixture 来源校验 | 外部根批准未发生；旧 hash 失败保留 |
| L08 | 25 排名、分学段 Hit@3=1 及原 aggregate 阈值 | 旧 finance-tax 稀疏标签漏 IMA／keyun／CGMA；盲评按任务摘要给 3／3／2 | 可提出标签遗漏复审；不能用更宽相关集直接宣称达标 |
| L09 | 18 v4 top1 acceptable／ideal90%／硬负例／3 个唯一 | keyun 当前 top1 超出旧可接受集合，独立任务标签为3 | 任务支持不足以决定综合 ideal；原断言全留 |
| L10 | 排除机械目标后 top3 至少2个机械替代 | 该 hard-negative persona 不在175输入；当前出现 IC／IoT 不能自行纳入 gold | 缺 exact-input 盲评；保留原名单和>=2门槛 |
| L11 | 分维 caps、有限非负、总分精确求和 | 新增全部96对的 30/25/20/15/10 五维合同、区间界限和精确总分 | 有政策依据的版本迁移候选；原七维断言留存 |
| L12 | 96 原窄区间至少90%通过 | 96个人贡献未知；新增 unknown 不可收窄为点值回归 | 无法等价迁移；不把宽区间命中当原90%达成 |
| L13 | 104综合排序关系100%通过 | 逐104映射，仅72有任务关系支持；单独导出两套诊断 | 无法等价迁移；104与100%原样保留 |
| L14 | explicit prospective capture，125输入及来源精确一致 | v2保留全部输入／固定对象哈希；记录硬排除null及资格证据；旧exact3／subset另测 | 真实分母已记录，旧质量门槛仍失败；消费者尚只接受v1，待迁移复审 |

## 确认的实际算法缺陷

第一次新政策测试 `policy-tests-01.json` 复现：`score-gold-005` 未提供本人角色或具体贡献，仍得到 experience=15.9、总区间 82.6–82.6；`score-gold-001` experience=16，只留下奖项目标未知。旧实现对缺失／unknown role 使用系数1，并以技能、证据类别、经历级别计算确定个人经历分。

此缺陷已交给 root 修运行算法，本任务不修改运行算法。后来工作区的新检查通过，原失败产物保留。新增要求把缺证经历维度的 **下界记为0并保留20点未知宽度**；这表示尚不可确认，绝不是认定本人能力为0。贡献证据与任务是否相关、字段确认及理由文案由 root 的专项测试补充验证。

## 可复跑验证与结果用途

以下命令使用仓库既有 Vitest。应在 root 冻结相关源码后记录最终执行的源清单、退出码和完整 JSON，不能将开发中不同源码下的结果混成一次验收。

```sh
python3 artifacts/continuation-20261105/legacy-migration/audit_migration.py
CAPTURE_LEGACY_POLICY_DIAGNOSTICS=1 node node_modules/vitest/vitest.mjs run tests/competitions/scoring-gold-audit.test.ts tests/competitions/followup-gold-audit.test.ts tests/competitions/gold-freeze-manifest.test.ts tests/competitions/quality-benchmark.test.ts tests/competitions/recommendation-quality.test.ts tests/competitions/strict-baseline-acceptance.test.ts --reporter=json --outputFile=artifacts/continuation-20261105/legacy-migration/final-six-suites.json
```

诊断开关只写 `policy-diagnostics.json`、`ranking-diagnostics.json`、`legacy-ranking-diagnostics.json`，不写标签或基线。原区间、原104与72任务关系逐项分列；完整池相关性诊断同时展示原稀疏标签，避免把“未标注”自动解释成“无关”。诊断 replay 测试通过只证明完整覆盖与可运行，不意味着其任务标签已被批准或质量阈值已经满足。

新增政策测试开发结果 `policy-tests-03.json` 为11 pass / 0 fail；51个原测试因名称过滤未选择，不能称全套通过。`policy-tests-01.json` 的个人贡献失败与 `policy-tests-02.json` 的新依赖缺pin失败也保留。开发测试源在并行变动，这些报告是修复诊断；最终固定源结果另行列示。

prospective 新分母仍须保持 `captureIntent=forward-regression-denominator-only`、`historicalComparisonAllowed=false`。源码依赖闭包在最终 capture 前重新核对，原125案例与输入保持不变。该新分母没有评价模型或推荐质量提升的资格。


## 前瞻 v2 候选与消费者交接

root 已确认 V5 相关评分／追问源码冻结。本轮闭包核对为22个基线来源文件；六套测试的静态本地 import 闭包加显式输入／toolchain共68文件另记 `final-run-source-lock.json`，不含并行任务仍在变动的 `src/content/competitions-v6/` 目录。

首次 capture 先暴露全池召回被误命名为Top10（90条），修正为与既有 quality-benchmark 相同的显式前10。第二次暴露原职校计算机设计anchor按本科-only事实已不再可评分。原交接 `artifacts/v6/legacy-review-20261105/REVIEW_REQUIRED.md` 第6条明确保留该职校负例／配对本科正例，运行目录的 `rules:computer-design-2026:full-time-team` 给出资格来源。第三次暴露原固定3个输出合同未满足。此前所有失败日志都保留，没有因为后续版本迁移删除。

经root明确授权，v2区分“真实当前分母”与“旧质量门槛”：

- 所有125条的dataset、personaId、inputSha256、fixedCompetitionId与保存的v1逐项相等，未换画像、未改固定目标、未删困难案例。
- `fixedPairStatus=scored` 必须有0–100有限分数且不能硬不合格；`hard_excluded` 必须score=null、qualification=ineligible、有hardFilterReason／reasons／sourceRefs，且该候选不能出现在其召回或最终列表。不能以0充当排除分数，也不能把needs_clarification当hard_excluded。
- 每条记录真实0–3个结果；前10长度／唯一性仍核对。旧“每条恰3个唯一结果、最终3个均属于前10”保留为独立全125测试，不再阻止保存真实结果。
- 均分仅对可评分项计算，并显式记录99 scored／1 excluded anchor、25 scored／0 excluded holdout。原排除项仍存在于125分母内；没有把可评分均值当全部样本均值或历史提升。
- 新负例拒绝硬排除项填0、缺来源、needs_clarification改成排除、排除候选回流Top10、可评分项改null；原字节／canonical SHA和当前结果精确比较继续生效。

`prospective-capture-05.log` 中当前v2记录和字节核验通过，但命令总体仍退出1，因为独立旧质量门槛发现：`anchor-basic-medicine-innovation` 返回2个，两个career-language holdout各返回1个；`anchor-optoelectronic-design` 的最终结果存在前10之外的候选。未补造第三项或调低此门槛。**当前分母已记录，质量仍未通过。**

发布消费者 `scripts/run-release-evidence.mjs:779` 仍硬编码 `competition-score-prospective-baseline.v1`，本任务按分工没有修改该脚本。root的后续发布合同迁移必须校验v2的nullable状态、资格依据、显式均分分母、125输入不变及canonical哈希，保留旧v1和原失败；更新需要独立来源审查和外部根记录。在此之前v2仅为待审候选，不能作为已可发布sidecar。既有capture入口并不负责给予发布批准。

## 固定源码下的最终结果

`final-six-suites.json`：**55 pass / 14 fail / 0 skip，退出码1**。其中v2真实记录／字节比对及125输入恒等通过，旧exact3／subset另项仍失败；其余旧评分、追问、质量、冻结门槛未被迁移绕过。原窄区间当前43/96（44.8%），原综合关系99/104，均不达原阈值；72/72任务关系诊断不替代104综合关系。详细机器记录见`final-verification.json`。

本次执行前后68份锁定输入／源码没有字节漂移。最后的测试命令未开启capture，只校验已记录v2，未产生供应商请求。最终候选根由`candidate-lock.json`固定；它及`review.patch`须由独立审查人核对，本任务不批准自身迁移。

最终TSC与6个修改测试文件的ESLint均退出0。一次并行新测试枚举错误造成的TSC退出2日志另存`typecheck-01-unrelated-enum-failure.log`；root修正后重新全仓typecheck通过，没有隐藏前次失败。
