# 开封后的实际观测评分

`score-product-observations.ts` 使用公开评分结构开发，未读取封存题值或答案。它评判真实 runner observations，而不把`observed`作为通过。

输入是开封后生成的显式JSON包：`cases`、`keys`、`observations`、`sources`、`semanticReviews`及`expectedRankingRepeats:5`。保留原始作者键、双评和裁决文件，不覆盖；若裁决包有外层字段，在开封后按公开合同显式归一化，并记录原文件SHA与字段映射。不得仅复制裁决者姓名而遗漏待定状态。任何原键仍有语义或适用性待定的题，汇总验收必须保持待定，不能因输出结构可读而通过。

工具先检查ID双射、重复运行、原始输入的canonical-JSON SHA、冻结正文SHA及操作绑定。条件题仅归一化公开裁决允许的`satisfied/meets_target`、`violated/fails_target/not_satisfied`，不扩大条件范围；事实题按claim ID比较，未知不等于反证。来源引用须逐字存在于相同冻结正文及scope。画像原文必须来自实际输入；多轮状态不得引用未来轮次，必须保留所有请求的checkpoint。

自然语言意义由两份独立输出评审判定，每份绑定具体key/observation的canonical-JSON SHA及明确的`rulePointer`。该指针指向私有规则；观测证据使用实际JSON指针和value SHA；来源证据使用sourceId、body SHA和原文span。双方须覆盖全部required/forbidden、画像事实与未知字段、多轮期望及变化、稳健性不变量；不同结论须第三个上下文裁决并绑定双方原review SHA。接口层只能验证文件绑定和审查覆盖，不能从名字字段技术性证明上下文隔离，因此仍保留会话隔离记录。

事实值为语义示例，不用关键词命中或全文字符串相等判断。确认、主体、个人贡献、否定、条件和撤回的意义必须保留；按该题冻结的`changedFieldsBaseline`比较实际表示中的变化，不能以更新了引文位置代替事实变化。表示可兼容不意味着可漏掉关键事实。

缺失执行为`not_run`，实际错误为`failed`，缺少双评或有争议为`pending`。源码中没有默认全通过、空集合通过或跳过难题的分支。两份同意评审不能覆盖明确错误的结构/标签/引文。排名120题始终交给`evaluate-rankings.ts`，取得完整候选池独立标签后另行合并；这里不从排名推导标签或把U当0。

示例（路径须为正式开封后冻结的包）：

```sh
node scripts/competitions/v6/score-product-observations.ts --open \
  --input opened-scoring-bundle.json --input-sha256 EXACT_RAW_BYTES_SHA256 \
  --output new-scoring-result.json
```

输出文件要求不存在；非全部已判通过时退出1。每题/每次运行和未执行分母完整保留。工具明确返回`productAcceptance:false`，因为画像F1、全池排名、500事实、引用质量、模拟理解和浏览器性能还需各自实际原始记录与统一门禁，不能由该局部结果推出最终上线验收。

验证：8项合成评分器回归覆盖缺双评、答案/观测变更、伪引文、自评、缺运行、错标签、裁决绑定及未标注排名；合成数据不作为800题实际执行结果。

## Unified scoring entry

`score-evaluation-bundle.mjs --open --input BUNDLE.json --input-sha256 RAW_SHA --output NEW_RESULT.json` combines the original product scorer with the full-pool ranking scorer. When including ranking evidence, also pass `--ranking-run MATRIX_DIR --freeze-manifest-sha256 SHA`; the entry verifies every frozen artifact byte and only allows review labels/status to change, preserving candidate-to-series mappings and family identities. The bundle includes the frozen `asOf` and `seed`. The bundle has `product` (the original scoring input), `selectedAlgorithm`, and optional `rankingEvidence:{input,observations,freezeBinding}`. Ranking evidence contains the whole formal 1800-row matrix with separately reviewed pool labels; every selected product report must reuse an original invocation. Cross-input, output, freeze or reservation mismatches fail closed. No ranking evidence keeps the combined result pending.

This entry returns actual dispatched recommendation counts independently of HTTP stage counts. It can resolve the ranking-label pending check only when the same invocation has complete AI-blind-reviewed pool labels. Missing reviews or unresolved original keys remain pending. It always returns `productAcceptance:false`; all aggregate thresholds, budgets and remaining evidence must still be checked by `acceptance-gate.ts`.

`plan-evaluation-matrix.mjs --input PUBLIC_COST_INPUT.json --output NEW_PLAN.json` is a no-call budget planner. Its input requires `schemaVersion:"saitu.evaluation-cost-input.v1"`, the current balance, authorized cumulative `fundedLimitCny`, cumulative charged-or-held spend, `totalCapCny:300`, and estimates by matrix row. Available funding is capped by both the provider balance and funded amount minus the existing ledger; balance is never treated as cumulative funding. Each paid estimate supplies `maxHttpPerInvocation`, `usageEstimatePerInvocationCny`, `reservePerHttpCny`, and the measured evidence SHA; performance and necessary repairs additionally supply the preregistered case count. Missing bounds stay null/pending. C's fixed worst case is four HTTP stages per run (match→verify→one repair→verify), or 2400 across 600 runs. The table also includes 15 interleaved public development calibration reports, 90 reports from six independent validation families across three tiers, the other 680 cases, a 12-profile pilot, 60×old/new simulated flows, separately registered performance work, two fixed release checks, and necessary repairs. Repair work is never counted as an additional independent recommendation. Estimates are not execution, authorization, settlement or invoice evidence.

11 月 6 日增加画像原子标注与硬条件错误的复算。正式机会出现前，在排序注册配置中一并冻结 `profileAtomProtocol`（见 `profile-atom-metrics.ts`）与 `constraintProtocol`（见 `constraint-audit.ts`）。两个指标复用原题编号、双审者身份、观测摘要和来源，不准用另一套样本替换。

画像评审在各自的原始 `semanticReviews` 中附加 `profileAlignment:{complete:true,pairs:[{expected,observed,reason}]}`。两端原子的顺序均是 facts 后接 unknownFields，索引从 0 计。两份语义等价匹配清单须一致，否则交给独立裁决者；每个原子最多匹配一次。确认标志和学生原话定位有误的原子不能计入 TP。剩余预测为 FP、剩余目标为 FN。全 120 题计算 micro-F1，按开封前注册的全部 templateFamilyId 报最小切片 F1，空分母为 null。

硬条件评审另附 `hardConstraintAudit:{violated,reason,evidence,sources}`，引用真实输出指针及本题冻结正文，不以关键词判断。实际判定放行了应拒绝或未知的条件时，必计一次违规。同一道题即便有多个问题，也只计一次。缺少执行、来源、双审或分歧裁决时，保留原 300 题分母并标记待评。

事实与引用另需在同一排序注册配置冻结 `factAuditProtocol`（见 `fact-claim-audit.ts`）。审查全 100 道事实题和 120 个画像中所选算法第一次展示的报告，含回退。评审逐段覆盖规定的报告陈述、参赛条件、报名说明及事实判断，从真实文本定位每个原子，标记准确性、关键性和所展示的各个引用是否支持。纯建议或没有事实断言的段落须显式标为空原子。每条准确的事实与每个有效引用均须有冻结来源原文、摘要和届次范围。核心判断的错误数、原子准确率及引用精度和覆盖率分别计算。相同事实的多次展示在明细中保留为多次展示，统计单位是被审查的原子出现次数。要核验目录额外来源，可在登记中固定 `factAuditCatalogSources`，其每项须回绑冻结目录来源与原件及正文摘要。正式原始包的可选 `factReviews` 给出两个独立原件和分歧裁决，未审段落、缺少来源或样本不足均不能据此签发结论。

推荐理由指标核对所选算法 600 份原始报告中每一条实际展示的 `recommendations[i].reasons[j]`。注册 `reasonProtocol=all_displayed_reasons_in_selected_600_original_observations.v1`，再把原始逐理由双审与裁决封装为 `reasonReviews`。两份独立判断须绑定同一报告及其真实理由；已撤销的学生事实、错绑的比赛事实或无法核对的引用不能作为有效理由。错误、空报告以及缺少判断单列，原始分母不随修复而改变。

能力夸大、撤销、更正、版本约束和反事实响应使用 `stateAuditProtocol=frozen_800_case_obligation_inventory_v1`，必须把 `stateObligationInventory:{path,sha256}` 放进开封前的注册配置。清单覆盖全部 800 个题号，逐项绑定原输入、原答案及具体义务指针。没有适用义务的题仍有空清单行。反事实项目需事先指明两个不同输入的原始观测，或同一稳健性题的真实 baseResult/perturbedResult。观察后以 `stateReviews` 绑定两个独立结论和必要裁决，未知、未运行和错误分别累计。无真实配对或缺任一必查类别时不能用自填比例过关。

画像 F1 必须额外登记 `profileGoldReference`，再把每行 `profileAlignment.goldSha256` 绑定到该题的完整参考清单。旧钥匙中的示例事实继续用于原题断言。两份干净输入逐字匹配原题，原始 A/B 独立穷尽 facts 和 unknownFields，其各自的原件摘要绑定到单独的裁决文件。存在分歧的题另需绑定两份原始行的哈希。F1 评分器既不把旧示例默认为穷尽金标，也不改写原始钥匙。原始参考在正式注册之后才封存时，不接受其作为本次预注册参考。
