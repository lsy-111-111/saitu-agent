# 冻结实验入口

当前runner为v2。A0是固定历史v5产品基线，A1是同目录同画像规则基线，B是本地BM25+E5候选并集及透明原生维度重排，C是真实DeepSeek Flash比较。历史v1的`A`标签只在旧产物保留，不再作为新CLI别名。

默认离线A1，每画像恰好5次；候选顺序由主种子、profileId、重复编号确定，可回放。同一重复各臂使用相同候选顺序，A1内部保持规则得分排序，B内部按其透明重排，C不能借用其他臂输出。

```sh
node scripts/competitions/v6/run-experiment.mjs \
  --input artifacts/v6/evaluation/experiment-profiles.json \
  --algorithms A1 --phase E2 --seed 6141 \
  --output artifacts/v6/experiments/NEW_RUN
```

输入格式仍为`{origin,asOf,profiles:[{profileId,familyId,taskGroup,profile}]}`；profile必须通过实际画像schema。`origin`支持synthetic、reviewer、ai_authored_sealed及旧公开种子标记。来源声明不自动赋予封存资格；正式封存另外通过challenge manifest与统一acceptance gate。任何输出目录必须全新，保留失败运行，不覆盖原证据。

## 本地强B

实验入口同时接受严格的 V5 与 V6 画像合同。V6 输入的 `profileId` 必须与实验行一致，并完整保留原回答、来源位置、领域字段、确认状态和撤销关系；仅为旧评分组件生成兼容投影，实际决策上下文继续使用完整 V6 画像。未知合同或身份不一致直接拒绝，不能经 V5 解析丢弃新事实后继续比较。两类输入和对应决策上下文均原样冻结进产物。

固定`@huggingface/transformers`依赖和`Xenova/multilingual-e5-small`的revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`，CPU q8，E5标准query/passage前缀、均值池化、归一化。原始模型来自intfloat/multilingual-e5-small。`e5-assets.lock.json`固定五个实际文件的SHA-256；每次加载先核对字节，再启动只读本地推理。实验记录保存锁文件SHA和逐文件校验结果；缓存旁边的下载manifest不能替代仓内锁。原模型卡声明MIT许可，转换仓明确引用该原模型，相关来源见锁文件。模型准备命令明确下载权重，推理不使用第三方API；默认推理只读本地缓存，缺失则B not_run而非假装已用向量。

```sh
node scripts/competitions/v6/local-e5.mjs --prepare-cache /absolute/model-cache
node scripts/competitions/v6/run-experiment.mjs \
  --input artifacts/v6/evaluation/experiment-profiles.json \
  --algorithms A1,B --e5-cache /absolute/model-cache --phase E2 \
  --output artifacts/v6/experiments/NEW_AB_RUN
```

BM25使用英文词及中文单字/双字，k1=1.2、b=0.75；精确余弦检索和BM25各取60，RRF k=60并集。E2跳过独立召回裁剪，对全部同池候选评分；E3才允许裁剪。最终排序90%为与 A1 相同的原生支持下界（目标与成果25、任务20、兴趣10、自述技能10、本人经历20、准备10、预算5），10%为归一化RRF，保留分项与unknowns。未知不重归一化成更高适配，也不解释为能力差；语义相似不代替资格或个人适配。

## 真实Flash C

显式选择`--algorithms A1,B,C --live`；服务端配置与付费账本必须由操作者完成。runner不加载.env、不输出凭据、不自行付费。业务模型固定Flash，默认`--effort max`，明确thinking启用。high/low只能作为单独预注册的完整配置，不能在失败或预算不足时静默降档。

E2注入完全相同候选ID、事实、画像，C跳过独立候选发现，直接比较同池完整事实包。5次乱序不会增加独立样本量。排序池标签初始全部U；未完成完整池盲审，nDCG保持null。

E3当前为 **not_registered**，执行入口会明确拒绝，未产生正式检索消融结果。已预留`--phase E3 --candidate-policy full|hybrid60`配置及子集构造代码，只有另行冻结协议后才能启用。该设计将BM25/E5各Top60并集注入C并禁止二次发现，同时保留原候选池作标注分母。E2始终拒绝hybrid60。没有至少100候选完整审计目录与20画像全量标签时，不声称Recall@60达到门槛；并集大小可能超过60，不能将其召回混称Recall@60。

产物包括实际报告、候选顺序与seed、目录/画像/context/实现SHA、模型/实际effort、usage/cache/价格版本/费用状态、失败回退及冻结文件manifest。实现字节在运行期间改变会阻断实验。token、价格或费用缺失保持null；`usage_upper_bound`是价格快照估算，不是账单。正式费用以统一付费账本核对。

## A0真实历史回放

```sh
node scripts/competitions/v6/capture-historical-baseline.mjs \
  --input artifacts/v6/evaluation/experiment-profiles.json \
  --output artifacts/v6/experiments/NEW_A0_RUN
```

固定研究提交`3fb65140589be510e9db3296e792156e690648a6`导出源码归档，独立Vite alias执行该版本真实推荐入口。新版独有字段仅作明确记录的旧合同投影；不把不存在的旧字段假装提供给A0。源码、画像、遗漏字段及结果均留证。A0是旧产品对照，不能混入E2同候选排序实验归因。E2 runner中请求A0会明确not_run，使用此独立入口才产生A0证据。

已实跑6个公开开发画像的A0和A1×5，无付费调用；这些仍是开发材料，不是800题正式挑战集。旧offline-a目录保留历史运行，不合并增加样本数。

CLI控制与种子测试：`node --test tests/competitions/v6/experiment-runner.test.mjs`。指标/检索/gate用对应Vitest；正式产品判断见`ai-proxy-acceptance.md`。

## 正式矩阵与同次调用证据（续做衔接）

`frozen-ranking-executor.mjs` 是 A1/B/C 的共同服务端执行入口。相同画像与重复编号先确定全池顺序，C设置 `skipIndependentRecall:true`；B必须返回全部原候选，不能隐式裁剪。它在**同一次调用**中产出真实报告、ranking row 和 EvaluationObservation，并以 `invocationId`、canonical输入/输出SHA、候选集合SHA、费用预占 `reservationIds` 及 `freezeBinding` 关联。不存在将客户端画像或候选提升为可信服务端数据的HTTP入口。

`product-observations.json` 保存三臂全部观测；`observations/` 保存逐次观测。`freeze-manifest.json` 同时覆盖排名输入/结果、观测、报告、阶段记录、实验汇总、画像、目录、实现、登记和开封收据。缺失标注仍为U，结果仍pending。

正式使用 `experiment-registration.mjs --config PUBLIC_CONFIG.json --output NEW_REGISTRATION.json` 登记；登记只读公开配置和源码，不打开输入。配置合同：

```json
{"schemaVersion":"saitu.ranking-registration-config.v1","purpose":"ai_proxy_acceptance","phase":"E2","candidatePolicy":"full","seed":6141,"effort":"max","repeats":5,"algorithms":["A1","B","C"],"profileCount":120,"inputSha256":"<输入原始字节SHA>","challengeManifestSha256":"<挑战清单SHA>","sourceSnapshotSha256":"<来源快照SHA>"}
```

经授权开封后，显式传 `--registration FILE --registration-sha256 SHA --open`，并保持原有 `--input FILE --output NEW_DIR --algorithms A1,B,C --phase E2 --candidate-policy full --seed 6141 --effort max --e5-cache DIR --live`。登记/源码/配置不符即阻断；读取输入前先保存开封收据。正式输入的每行另外带 `caseId` 和原题完整 `input`（其 `profile` 必须与该行画像完全一致），120个独立族、六组各20族，且均为V6画像。题目输入字节/输入SHA保留，不为匹配评分器改写题义。

正式矩阵固定为120×5×A1/B/C＝1800份报告。最终方案的600份直接复用于800题中120个排名题；另外680题才调用产品。禁止另跑一次相同600份。重用流程见 `sealed-product-runner.md`。

`executionCounts.actualModelRuns` 对真实触发 `ai_transport_dispatch` 的推荐调用按唯一 `invocationId` 计一次；match、verify、repair、再次verify最多四个HTTP阶段仍只算一次运行。回退保留在评分分母，但不能算 `successfulCRuns`。无网络派发、预算拒绝和未执行不增加实际模型运行数。费用usage估计、保守预占和供应商账单保持不同字段。

### 显式分批与恢复

正式注册配置可加入 `batchPolicy`。固定顺序为 `profile_then_repeat_then_arm`；`runsPerBatch` 规定每次启动最多新增的排序运行数；`maxCReservationMicros` 为完整一次 C 匹配、修复和验证的保守上界（整数微元，须用公开实测与可强制执行的限制确定）。必须使用相同本地 PostgreSQL 正式账本、注册文件、输出目录和已冻结配置。每次 C 派发前核对可用额，并限制该调用范围内的预占；数据库仍逐次执行原总账本约束。

首次用原 `--open` 启动，达到批次上限或费用不足时以退出码 2 保存进度。再次启动时在原命令加 `--resume`。执行器校验最初的开封收据、配置、输入、目录摘要及运行编号。每份运行先落盘唯一意图，再派发，成功后持久保存含费用预占编号和输出摘要的结果。中断留下意图但没有结果时，该次进入 `indeterminate` 并保留费用占用，恢复不会重发。原始预占和派发事件写入同一编号的账务日志，可用于人工核对。缺少一次正式观测即不能生成完整矩阵或复用 600 份。原整批注册仍使用原参数。


分批正式登记另须固定唯一公开开发主基线。使用
`node scripts/competitions/v6/select-development-baseline.mjs PUBLIC_RANKINGS BLIND_DEV_REVIEW NEW_BASELINE_SEAL PUBLIC_PACKET_MANIFEST`
从六个开发族、A1/B 各 30 次和完整相关性标注重算；将文件相对项目根路径、文件原始 SHA-256 与选中算法填入 `baselineSelection: {path,sha256,algorithm}`。只有登记时间不晚于首次正式开封、证据可以从原文件重放，才可用 C 相对增益和配对置信区间作判断。分批登记不是 C 的放量许可；公开的五次匹配、核验、学生页面交付及事实复核仍单独登记。


在已登记且已授权开封的完整矩阵中，`--defer-c` 保留 C 槽位但不向模型发送请求，可继续跑免费的 A1/B。C 预占不足时执行器也会保留其未执行原因并继续查验其余槽位。批次达到上限后仍统计此前的有效收据。进度表分别列出完成、未执行和派发结果未知，分母始终为 1,800。解除推迟仍须同一冻结版本满足真实页面条件。

矩阵与两份原始评审封存后，`node scripts/competitions/v6/select-ranking-arm.mjs --open BUNDLE SHA NEW_RESULT` 单独决定哪一臂可以复用。输入的 schema 为 `saitu.before-reuse-selection.v1`，包含 `asOf` 和三份原件引用 `matrixFreeze`、`challenge`、`rankingReviews`（相对项目的 path 与原始字节 sha256）。工具验证全部 1,800 个槽位，从原始 A/B 判断计算一致性，重放公开基线选择，按 120 个族比较 C 的配对区间和各任务组最低门槛。如果没有排序达标的算法，输出空选择。此步骤无需再调用模型，也不读取其余 680 题的产品答案。完整引用、画像、状态更正及其他专项门槛仍需在 800 题正式结果中另行验证。

付费分批启动前还复核 `cPageAdmission`，包括五页原始 manifest、候选产品源码锁及独立关键事实/资格检查的相对路径与摘要。公开准备命令 `node scripts/competitions/v6/c-page-admission.mjs GROUP_MANIFEST SHA NEW_AUDIT` 可先逐页验证请求 ID、完整候选乱序、真实派发与预占、报告摘要、DOM、截图和核验结果。少于 4/5 时退出 2，仅能保留诊断。独立审查人实际完成复查且同组收据登记后，才开放正式 C 批次。未登记的公开/合成材料不能自行授权付费。
