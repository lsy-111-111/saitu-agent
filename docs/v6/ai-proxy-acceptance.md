# AI代理验收执行合同

本轮经用户选择使用分离上下文的AI出题、双盲审与模拟学生。数值门槛保留，但证据类别改变：AI结果不得填写真人评审身份、真实学生人数或生产审批。`originalAllProductGatesPassed` 仍不能因代理指标通过变为true；新合同使用 `agreedAiProxyGatesPassed`。完成范围是冻结上线候选，不部署。

## 工程检查与产品门槛分开

`scripts/competitions/v6/acceptance-gate.ts` 是最终门槛入口。输入必须包括800题封存清单、逐题执行状态、原始指标、分母、证据文件路径及SHA-256。CLI先核对证据字节，再评估；缺数据、缺证据、U标签、未运行及未计价调用都不能变成通过。代码中 `PRODUCT_GATE_RULES` 是可审阅的完整阈值表，覆盖事实/资格、画像、排序、覆盖、内容、理解、性能和工程回归；C成为默认还需相对最强预注册基线+0.03且配对区间下界>0。

```sh
node scripts/competitions/v6/acceptance-gate.ts --input acceptance-input.json --output acceptance-result.json
```

脚本核对结构、数值与字节绑定，不能自行证明来源或评审可信。指标采集器与审查责任仍须逐项留证。不得手填“通过”指标后用一个无关文件的哈希签发结果。现有单测绿、结构合法和无新增失败不能替代此入口；旧27项必须真实修复或经有证据的版本迁移闭环。

## 800题封存材料如何产生

保留300硬约束、100事实、120排序、120画像、80多轮、80稳健性配额。120排序题必须有120独立画像族，六任务组各20族。96公开种子及至少36个开发族只能用于开发，不计入800。封存清单要求开发输入hash、familyId与templateFamilyId排除表；自动查同hash和族交叉，语义近重复仍须单独盲审。不能自动循环800次模板生成并宣称独立题库。

由根任务分别启动最小上下文出题/评审代理：作者只收需求和已冻结的来源材料；评审A、B各自接收确认画像、随机顺序完整候选事实，不见算法名、排名、作者答案或另一评审评分；第三裁决在原始评分冻结后才见分歧。每条记录作者、双评审及裁决上下文ID，角色不可复用同一上下文。算法作者不得读取封存答案调参。

记录 `origin:ai_authored`、`evidenceClass:ai_proxy`、`isolation:separate_contexts_shared_filesystem`，以及资料、实现、配置、答案hash和封存/打开时间。当前共享文件系统仅提供流程隔离，不能声称外部权限隔离。正式独立人类金标须另有外部访问控制与真实人审证据。

失败后保留全部失败、空输出、回退和预算日志，旧集转回归，修复后另造未见挑战集。不能反复调同一封存集直到通过。若预算不够形成新的完整验收证据，状态是未完成。

## 排序与模拟理解

AI双盲评分使用 `annotationStatus:ai_blind_reviewed` 和 `purpose:ai_proxy_acceptance`；与 `independent_reviewed` / `sealed_acceptance` 分开。纯排序在运行前冻结完整统一候选池及事实，每个候选均完成独立0–3判断，U必须补审；不按已看到的各臂Top10并集缩小评分池。评审不见算法输出。五次生成先按画像、再按族聚合；错误/回退按实际展示结果评分，不消失。

12个模拟角色先检查题目和流程，之后至少60个预注册模拟角色完成旧/新流程及五题理解测验。独立出题代理依据画像和官方原文出答案，不直接抄模型报告。理解均分85、下一步80%、快流程完成率85%仍用作AI代理阈值。旧系统开发均值≤80时要求+15及区间下界>0；天花板情形的非劣效/误解下降路线必须在实验前登记。

`actualParticipants`保持0；模拟耗时不是4–6/8–12分钟真人回答时间。这些真人指标写未实施，不以脚本速度填数。AI模拟结果只能说明模型在该模拟分布的表现，不能外推学生理解效果。

## 模型与预算

业务模型固定DeepSeek Flash，thinking启用、effort默认max。high/low仅作为预注册对照；只有同时通过全部绝对门槛、nDCG@5相对max的配对95%区间下界大于0、其他关键质量指标不退步，并在冻结配置后通过新的未见800题复验，才能替换max。非劣、便宜或更快均不构成单独充分理由。独立保留300元总上限及当前到账额度，不进行超额调用。

E5为本地模型，不消费DeepSeek余额；其下载与本地耗时也要记录。实际API费用按治理账本预占/结算，runner所收 `usage_upper_bound` 是价格快照上界估算，不应改名账单。所有修复、超时及失败调用均保留。

## 原始证据派生边界（工程审查 R1-02 修复）

`evaluateProductAcceptance(input, evidenceRoot)` 现在在入口内部读文件、校验字节、识别产物合同并重新派生指标。调用者的 `metrics.value/denominator/evidenceClass` 只是待核对声明；返回的 `actual` 只来自已通过原始派生的值。旧版第二参数 `Set<path:hash>` 不再具备任何批准能力；传入它会阻断。`verifyMetricArtifacts` 的新签名是 `(完整AcceptanceInput, root)`，返回逐指标的 `derived/pending/invalid`，不能作为外部证明再传回入口。

白名单在 `acceptance-artifact-derivation.ts` 的 `ACCEPTANCE_METRIC_DERIVERS` 中按 **metricId + schemaVersion** 固定。新增一份JSON里的“已验证”字段、复制其他指标的文件哈希、使用性能/排名汇总中的手填数值，都不能登记新验证器。路径与真实路径必须位于指定证据根内，符号链接不能绕过边界。

最初接入的 `actualModelRuns` 派生器读取以下引用包（新增预算和性能派生器见下节）：

```json
{"schemaVersion":"saitu.acceptance-ranking-dispatch-evidence.v1","challengeManifest":{"path":"artifacts/EXACT_CHALLENGE_MANIFEST.json","sha256":"<原始字节SHA>"},"freezeManifest":{"path":"artifacts/EXACT_MATRIX/freeze-manifest.json","sha256":"<原始字节SHA>"}}
```

它核对挑战清单、实现/配置/来源绑定、登记及开封、全部冻结产物字节、120画像×5×三臂的1800唯一组合、逐次输入输出哈希，并将产品派发事件与同次调用的formal/max预占及结算事件关联。只有存在真实派发记录的C推荐调用才计一次；四个HTTP阶段仍为一次，回退/错误保留，not_run、注入事件、跨调用reservation、重复invocation及手填运行数均不能充数。`configurationSha256` 与挑战清单必须指向同一冻结配置；原始费用未知不会在此被填零。此派生器只证明观测记录所支持的调用分母，不证明模型质量、完整标签、账单或全产品通过。

**当前不可宣称验收已完成。** 800题原始评分接入候选现已实现（`acceptance-raw-scoring.ts`），已完成R2范围内独立代码复审；真实封存执行仍未进行。它重算1800排名矩阵、核对选定600观测原样复用及其余680执行，再验证逐题答案、来源、双评审与裁决绑定；代码内有限独立来源登记当前为空，不能用 `sealedCaseExecution:800 passed` 或自填审查人覆盖。公开合成完整链只得到 rawValidated=true、独立登记pending，未开启真实题。接口及原件合同见 `artifacts/continuation-20261105/raw-scoring-adapter-01/README.md`；两项边界修复和独立复查见 `artifacts/continuation-20261105/raw-scoring-independent-review-r2/README.md`。预算及性能现已接入下节的原始派生器，但缺原始资料仍pending，不能用 `budget.unpricedCalls:0` 或性能summary覆盖。全池标签/排名、画像F1、引用、内容覆盖、工程与模拟理解等其余指标保持 `raw_metric_deriver_unavailable`，直到相应原始观测验证器实现并接受独立审查。

验证使用公开合成文件：真实CLI面对“not_run、realProduct:false、actualModelRuns:0、labels:U、费用null”的同一文件，即使SHA匹配且所有声明数值达标，也退出1且所有gate不通过。合成完整dispatch链只验证局部计数逻辑，不作为正式调用、封存题或产品质量证据。共享文件系统与原始产物合同也不等于外部防伪证明；独立评审与账本来源责任仍保留。

R3衔接补充：`actualModelRuns` 必须读取冻结清单里的 `runtime-configuration.json` 原件，校验公开字段白名单及schema，并核对原件canonical SHA、`freezeBinding.runtimeConfigurationSha256`、登记中的runtime SHA和完整runtime对象一致；`experiment.runtimeConfigurationUnchanged` 必须为true。门禁还使用登记的phase/seed/effort/repeats/candidatePolicy/algorithms与runtime SHA重新计算 `configurationSha256`，不能只相信挑战清单和freeze中两个相同的声明。缺失原件、重新计算外层文件SHA后的runtime漂移、未保持runtime及任意额外环境字段均阻断。这里核验冻结的公开运行控件，不读取或输出API key、数据库连接串等secret，也不比较验收机当前环境来替代运行时原件。其他未实现派生器继续pending。

## 原始账本预算与浏览器性能派生

门禁现已实现 `budgetEvidence` 前提及 `firstScreenP95Ms` / `fullReportP95Ms` 两个派生器。它们仍不能替代800题评分、全池标签或其他质量门槛，也不会将整个产品验收标为通过。

预算输入新增 `budgetEvidence:{path,sha256}`，引用 `saitu.acceptance-ledger-budget-evidence.v1` JSON。包内 `baseline`、`snapshot` 均为 `{path,sha256}`；基线字节SHA固定为 `b060c9199cffa7123e9fd7534a2de4b4402553ae03a9cbc1a113232a1e01d8be`。消费者核对只读一致性全表导出、原authority、额度未扩大、时间顺序、48条主run原ID及至少8.664228元占用，还保留其余430条历史记录。任何历史行消失、改身份或减少占用均阻断；不能凭run名称或“test”字符串排除。

预算汇总区分 `unknownUsageCalls`、`unpricedCalls`、`unknownOriginCalls` 和 `incompleteUsageRows`。完整保守预占属于已有价格上界下的占用，不自动等同未定价调用。对于reserved/conservative，原始来源记录中的 `requestLimits:{promptUtf8Bytes,systemUtf8Bytes,outputTokenLimit,priceVersion}` 必须与固定peak价格重算的上界一致，且账本全额保留该占用；符合时即使usage未知也可满足预算安全。它不是供应商实际发票。未核实的SQL测试fixture先保留为待核范围及保守上界，不冒充已确认供应商支出，也不自动归零；经独立来源证明后可以退出供应商预算范围，原始账本行仍完整保留。

完成来源核对需另提供包内 `sourceObservations` 和 `sourceReview` 引用。前者为 `saitu.ledger-source-observations.v1`，`records`逐reservation记录 `reservationId/runId/origin/events`（及需要时的requestLimits），origin为 `live_provider` 或 `synthetic_transport`；live来源还须有匹配model/operation的真实派发事件，settlement的费用、状态及usage必须与账本一致。后者为 `saitu.ledger-source-review.v1`，绑定snapshot、固定baseline、sourceObservations原始字节SHA，具有独立author和两份不同context的reviews。每份review的rows必须逐行绑定 `reservationId/ledgerRowSha256/sourceRecordSha256/verdict`。默认verdict为 `accounted_without_exclusion`。没有原始来源/双审、缺可重算上界或实际未定价时返回pending；未知usage本身不再是永久阻塞条件。

AIR1-02修复后，当前证据包里的两个评审名称、comment-only源码和自述deny_all执行JSON均不能授权排除。排除权限来自实现内私有、默认空的有限历史来源登记：固定reservation ID、原行SHA、独立预封存registration SHA、完整fixture依赖闭包SHA及真实原始执行SHA。该登记没有公开参数、环境变量或测试注入入口；只有取得独立可信来源后，经另一次代码与冻结审查才能加入。当前尚无可信登记，所有synthetic排除请求保持 `trusted_synthetic_origin_registration_required` pending，不读取当前envelope自签证明来授予权限。将来登记的原始合同为 `saitu.sealed-synthetic-origin-registration.v1`、`saitu.synthetic-fixture-source-closure.v1` 与 `saitu.sealed-ledger-fixture-execution.v1`，必须匹配预先固定的确切字节、有限历史行和外部强制无网络执行关联；不能给新ID或任意源码通配批准。48条主run始终计入且至少8.664228元，所有478条历史行及占用校验保留。汇总区分 `allTableEvidenceMicros` 和可信审查后的 `providerBudgetAccountedMicros`，未核来源不宣称更大的实际花费。

AIR1-01修复后，live usage以BigInt精确重算微元费用：`ceil(((input-cached)*50 + cached + output*200)/25)`，固定DeepSeek Flash及已冻结peak价格版本。token必须是安全非负整数且cached≤input；原行charged、settlement费用与usage、upstreamAttempted/state必须一致，已知usage费用不得越过预占。原始请求limits还重算reservation并检查实际input/output不超过上界。1,000,000,000未缓存输入token及1输出token必须为2,000.000008元，不能用0元ledger或settlement蒙混通过。未知模型/价格保持pending。主authority的live usage在任何来源pending判断之前完成重算，避免未核fixture掩盖漏计新调用。

现有真实snapshot尚无完整可信历史来源登记，故预算仍pending。其中398条历史SQL fixture标为usage_estimated但tokens为空；它们单列不完整元数据，不能凭标记证明真实模型usage，也不改写为真实支付。测试只验证整数计价、拒绝漏计与自签排除；不会生成历史执行或批准材料，不代表现实fixture已经被审查或排除。

性能指标引用 `saitu.acceptance-browser-performance-evidence.v1` 包，包含以下原始文件引用（均为path+sha256）：`challengeManifest`、`registration`、`profileReview`、`implementationBefore`、`implementationAfter`、`runtimeConfigurationBefore`、`runtimeConfigurationAfter`、`runtime`、`buildArtifacts`、`ledgerBefore`、`ledgerAfter`，以及逐journey的 `rows` 引用数组。源码和runtime使用runner实际输出的before/after合同；`buildArtifacts`引用generated-build-artifacts.json，消费者读取其实际复制的BUILD_ID、build-manifest.json、required-server-files.json、next-env.d.ts字节，不信任summary中的生产或不变布尔声明。

性能派生直接复用product-performance的登记、独立画像审查、画像语义、原始clock与response校验，再要求最终挑战实现SHA、前后源码字节、正式production/deepseek/max/无mock runtime、真实PG只读账本前后原件及runtime查询绑定、HTTP路径/时间/确认点击、响应报告SHA和实际画像一致。100次/60独立画像/双端各50/快深两流程门槛不变。缺原始文件pending；缺行不能缩小分母；失败与timeout保留为无限延迟参与95分位计算，无法形成有限p95时保持null。没有正式生产浏览器记录时不得使用mock smoke或人工填写summary标量代替。

## 11 月 6 日专项评分接入状态

原始指标的实现进度以当前 `acceptance-artifact-derivation.ts` 的登记表为准。47 项基础门槛中有 22 项具备原始数据计算入口，另有 C 的相对 nDCG@5 增益和配对区间两项。表内包含画像原子 F1、硬约束、事实与引用、理由、画像状态、更正、反事实、排序、原始评审一致性、调用及性能。事实或理由的独立审查、精确来源、完整穷尽金标和产品原始执行仍由各自合同验证，缺少证据的结果为待定。旧段落中“其余指标保持 unavailable”描述的是当时版本。

开发基线选择、AI原始双审一致性和学生追问均有单独实录。正式挑战集保持 800 个逐项状态，三算法保持 1,800 份原分母。付费开发上限与正式开放条件分别判断。单次离线排序结果或公开页面的追问答复均不能补入正式矩阵。登记和算法选择见 [专项状态与依据](../../artifacts/specialist-20261106/README.md)。
