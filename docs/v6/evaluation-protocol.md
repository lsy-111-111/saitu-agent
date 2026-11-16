# v6 评测与事实边界

> 历史实施记录：下文的调用配置缺失、27项失败、旧开发运行和真人研究安排描述的是最初快照，不是当前进度。当前执行以用户批准的AI替代续做计划为准；最新逐项状态见 `artifacts/continuation-20261105/task-status.json`，原始结果按各自源码摘要保留。正式排序使用完整候选池及120个独立画像族×每算法5次；旧文中的候选并集试标不能缩小该分母。现有API配置已经找到，AI模拟不能宣称真人验证。

本文件记录可执行评测口径。数值是待验证的产品目标；脚本、开发样例和模拟返回值通过，不等于模型或产品效果通过。

## 已执行基线

- Node v24.22.1；现有完整 Vitest：939 项，889 通过、27 失败、23 跳过。
- 27 项与原项目历史报告逐项一致。原始输出见 `artifacts/v6/baseline/`，逐项原因、后续行动和保留保护见 `artifacts/v6/failure-triage.json`。
- 8 项发布合同测试在同一个冻结来源哈希检查处停止；另有冻结金标文件哈希和前瞻基线版本差异。没有改写冻结文件、删除测试或重新捕获历史基线。
- 两项硬资格测试使用的旧 oracle 与当前“可调整队伍 / 明确不可取得资源”语义不同。237 条候选告警不能直接称为已证实线上违规，也不能忽略。新增对应正反例必须保留：固定冲突排除，未知/可调整明确显示条件。

## 执行顺序

1. 先运行新的确定性资格、引用、画像、更正、报告合同测试及原有相关回归。
2. 在同一目录版本、同一完整候选、同一确认画像上运行规则 A1 和 LLM C；共用报告渲染。A0 只作历史回放。
3. 接入一个语义/规则混合 B，开发集选定唯一主要比较对手，冻结提示词、模型和调参次数。未调用真实模型时只报告规则结果与模型待测，不把 mock 称为 C。
4. 有实际成本/延迟问题时才测候选裁剪；有边界排序问题时才测小范围成对比较。新增实验先记录目的与单一变量。
5. 独立封存材料可用后做正式比较；再检验真实学生理解。工程工作不因招募待定而停止，但不能替代外部证据。

## 本次已实测与尚未测量

最终代码冻结后的完整回归为1109项：1059通过、27失败、23跳过；按文件路径和完整测试名逐条比对，27个失败与改动前相同，新增失败0，没有缺失/跳过的旧失败或未产生断言的失败套件。对比证据见 `artifacts/v6/evaluation/regression-comparison.json`。从同一份完整回归提取 `tests/competitions/v6/` 下14个文件，共170项全部通过，逐项记录见 `artifacts/v6/evaluation/v6-suite-summary.json`。较早的 `engineering-evaluation-tests.json` 保留118项评测/案例子集的原始结果，不能代表全部新版测试。完整构建通过；全仓测试没有全绿，不据此签发发布许可。

| 产物 | 实际完成 | 不能据此声称 |
|---|---|---|
| 96个公开种子 | 全部映射可执行检查；63个工程检查通过，24个排序结构检查通过但待独立评审，9个未运行 | 96个模型能力测试通过、96个独立画像或金标 |
| 6类产品场景 | 真实目录生成7份完整规则报告，包括更正前后；合同与引用检查通过 | 来自真实学生或推荐适配已经独立验证 |
| 6学科开发画像 | 每画像5次实际规则运行，共30次；保留完整候选池，标签全为U | 已完成A/B/C效果对照或模型优于规则 |
| 40需求画像覆盖 | 40个合成确认画像实际进入引擎；严格覆盖0/40；自动任务相关≥3系列14/40，≥2路径36/40 | 未知资格或未知个人总支出已经满足条件；自动任务关联等于独立适配评价 |
| 真实B/C、理解研究 | 当前未运行；没有可用的真实模型调用配置或已招募学生 | 新模型质量提升、成本达标、真实理解分达标 |

最新A复跑证据为 `artifacts/v6/experiments/offline-a-final-20261105/`，仍是6个公开合成开发画像、每画像5次、共30次规则运行。旧目录保留历史复跑记录，多轮执行不会增加独立画像数。所有相关性标签仍为U，nDCG保持null；没有实际B/C模型调用。

9个未运行种子属于 Swift 团队作品、离线提交要求及集创混合学历队伍组别。当前接口没有这些完整的作品/队员结构事实，保留明确的适配器缺口；不会把预期答案当实际观察。画像种子的确认选择映射检查也不等于自由文本抽取准确率。

六类场景的索引为 `six-scenario-manifest.json`：零经历、跨专业、目标冲突、资源不足、当前起点与未来成长、更正重算。六学科是另一个开发集合，不能互相重命名充数。所有学生均标记 synthetic。

可重复执行的入口（仓库根目录）：

```sh
V6_WRITE_EVALUATION_ARTIFACTS=1 node node_modules/vitest/vitest.mjs run tests/competitions/v6/evaluation-*.test.ts --testTimeout=20000
node scripts/competitions/v6/evaluate-seeds.ts --observations artifacts/v6/evaluation/seed-profile-observations.json --observations artifacts/v6/evaluation/seed-report-observations.json --observations artifacts/v6/evaluation/seed-qualification-observations.json --output artifacts/v6/evaluation/seed-execution-results.json
node scripts/competitions/v6/evaluate-coverage-cli.mjs --output artifacts/v6/evaluation/coverage-results.json
node scripts/competitions/v6/run-experiment.mjs --input artifacts/v6/evaluation/experiment-profiles.json --output artifacts/v6/experiments/manual-run
```

种子检查器在存在未运行/失败时退出1，仍输出完整状态；不能把这个退出码改成“全部通过”。实验CLI默认只跑A，B/C必须显式选择 `--algorithms A,B,C --live` 且具备实际配置；详见 `run-experiment.md`。输入/输出token与金额未实测时保持null。覆盖产物含全部40份源画像、确认选择、候选与不足原因，目录审计只在快照和画像匹配时合并实测摘要。

完整回归与旧失败对比入口：

```sh
node node_modules/vitest/vitest.mjs run --testTimeout=20000 --reporter=json --outputFile=artifacts/v6/evaluation/full-regression.json
node scripts/competitions/v6/evaluate-regression.mjs
node --test tests/competitions/v6/evaluation-regression.test.mjs tests/competitions/v6/experiment-runner.test.mjs
```

完整测试仍会因旧27项失败退出非零。对比脚本检查文件路径与完整测试名、缺失/跳过的旧失败、未产生断言的失败套件，并记录原始报告SHA-256；对比成功仅表示无新增回归，不能把旧失败改为通过。脚本不会更新冻结来源或签发发布许可。两套Node CLI测试独立于Vitest计数。

## 排序指标的实际接口

```sh
node scripts/competitions/v6/evaluate-rankings.ts --input input.json --output results.json
node node_modules/vitest/vitest.mjs run tests/competitions/v6/evaluation-metrics.test.ts
```

输入 `saitu.ranking-evaluation.v1` 包含目录版本、算法列表、画像与 family、冻结候选池、0–3/U 判断、标注来源，以及每算法每画像恰好 5 次运行。每次运行记录实际展示 ID、原模型 ID（如有）、错误状态和回退是否发生。示例仅为指标自检，不作为真实推荐标签。

- 使用 gain = 2^grade − 1；IDCG 在同一池中先取每个系列最高等级赛道再排序。重复系列是合同失败，不能悄悄删除后计分。
- 整个候选池需要标注，不能只标 Top10；U、缺失标签和池外输出阻止该画像及该算法总体分数。保留阻断原因，不能从分母消失。
- 实际展示的空失败结果在存在相关项时计 0。失败后有回退则按真实回退列表计分，同时报告失败、回退数量；原始无效结果另记。
- 先平均同一画像 5 次生成，再平均同一 family 内画像，最后 family 等权。画像数、family 数、运行数分别报告。
- 无相关项（IDCG=0）单列，检验是否正确给出无候选，不混入普通 nDCG 平均数。
- `pairedFamilyBootstrap` 对相同 family 集做配对 bootstrap，禁止把五次随机生成当五个独立学生。区间仅在样本、分组与预注册适用时解释。
- 算法顺序稳定性比较 Top5 系列集合；同系列同等赛道替换不会被误判为全新竞赛。

## 正式题库建设目标：800 题，当前没有完成

| 层 | 计划数量 | 主要证据 |
|---|---:|---|
| 硬资格与明确限制 | 300 | 官方原文、适用范围、正反例 |
| 事实、来源与届次 | 100 | 原文复核与范围匹配 |
| 排序画像 | 120 | 独立候选池等级判断 |
| 画像提取 | 120 | 原话、否定、更正、贡献范围 |
| 完整多轮对话 | 80 | 前后状态、追问、重算与报告 |
| 稳定性与异常 | 80 | 乱序、注入、超时、回退、错误引用 |

120 个排序评审槽位分六任务组，各 20 个独立画像族；CSV 目前为空白待填槽位，不是已招募的学生或已完成画像。先试标 10 个画像估算工时，再补齐目标。每画像统一池包含所有预注册方案/重复运行 Top10 并集、人工补充、相邻负例及随机项，不能为了固定20项截断候选。两名独立评审分别标注，第三人处理分歧。公开开发种子不计入800封存题；同族变体不可跨开发与封存集合。

## 分层验收

| 层 | 可报告状态 | 建议目标 |
|---|---|---|
| 工程 | 可执行、可回放、可审阅 | 确认状态、引用、硬资格、更正和回退断言通过；旧失败逐项保留或有受审迁移 |
| 事实 | 事实复核完成 | 关键事实无观察到的错误；一般事实准确率≥98%，引用支持精度≥98%、覆盖≥95% |
| 独立排序 | 该样本范围有质量证据 | pooled nDCG@5≥0.85、@10≥0.80；对预选最强基线点提升≥0.03且配对区间下界>0 |
| 学生理解 | 真实学生更能选明白 | 理解均分≥85/100；可执行下一步比例≥80%；快速流程完成率≥85% |
| 发布 | 已有发布流程通过 | 所有发布来源、依赖、必需测试证据和回退满足既有要求 |

这些门槛不能互相抵消。未经独立评审的单人标签只能供开发；零观察到的错误不能宣称实际错误率为零。小切片样本不足时只作探索报告。

## 版本、成本和等待时间

每次实际运行记录目录、画像 revision、模型/提示词、候选、调用数、token、真实耗时、错误和回退。不知道供应商当日单价时成本保持 null；未调用模型时 token 和费用不能伪装成模型实测。候选事实变化后重建评审池，不能混用旧标签宣称提升。完整校验后一次性返回报告，45秒完整报告为待测目标；在实际部署并发下测量，不能用本地规则耗时替代。
