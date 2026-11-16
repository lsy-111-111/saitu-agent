# v7 评测与封存交接

本合同对应 `saitu.policy.2026-11-09.v7`。v6 的登记、1,800 矩阵、原题、金标及失败证据保持原格式和原状态，不能以本合同重新解释。工具的合成测试不等于正式题通过。

## 固定分母与门槛

800 题为约束 300、事实 100、排序 120、画像 120、对话 80、鲁棒性 80。排序保留六个任务组各 20 个独立画像族；B/C 每个画像各五次，共 1,200 次。A1 只用于开发。800 的 120 个排序题直接复用原矩阵 C 的全部 600 个 invocation，不生成第二套 C。

C 的 pooled nDCG@5 ≥ .85，@10 ≥ .80，每主任务组 @5 ≥ .75，Top5 系列 Jaccard ≥ .80。C−B 按相同 120 个 family 配对 bootstrap，2,000 次、95% 区间下界 ≥ −.02；不再要求点提升 .03。原始两名盲审者的 ordinal Krippendorff α ≥ .70 继续保留；U 或无变异导致 α=null 时不能通过，仲裁结果不能代替两份原件。该门槛见 v6 `acceptance-gate.ts` 的 `rawReviewerAgreementAlpha` 及 `select-ranking-arm.mjs` 的原始一致性判断。v7 初版遗漏的接入已在公开第一批后的补丁完成，空值、低值、原始覆盖缺失均有负例；补丁源码另行冻结，不把初版证据改为新版本通过。

事实准确率 ≥ .98，引用精度 ≥ .98、覆盖 ≥ .95、关键覆盖 100%；硬约束违规和关键事实错误为零。事实准确率的至少 500 个单位必须是实际输出中的独立事实命题，重复同一文本跨度不能凑数。画像采用预先冻结的穷尽语义原子参考，micro-F1 ≥ .95、每个预注册语义切片 F1 ≥ .90。更正成功和隔离 100%，有效理由 ≥ .95，鲁棒性反事实响应 ≥ .90。

普通题一轮独立复审，再定向复验；排序等级金标为两份盲审原件及分歧仲裁。`valid_reason/risk=low` 用 seed `20261109` 抽取固定 20%，identity 为 `caseId:checkId`；全部关键/事实/引用检查不受此抽样缩减。作者目前 220 个低风险建议槽位对应 44 个固定身份，正式观察前的最后数据版本需重新核对人口与样本原始摘要。

性能从浏览器原始提交点击前计时，直到名单/全部详情真正呈现在 DOM；服务端入队时间只作子阶段。100 个原始请求（桌面、移动各 50），名单 p95 ≤30 秒、全部详情 p95 ≤90 秒、ready 展开 p95 ≤1 秒。失败/超时保留在原始分母。

## 工具入口

在项目根目录用 Node 24。下列命令仅描述接口；正式开封和付费由主控统一执行。

```sh
node scripts/competitions/v7/evaluation-migration.mjs --inventory PUBLIC_IDENTITIES.json --output NEW_MIGRATION.json
node scripts/competitions/v7/evaluation-matrix.mjs --input MEASURED_COST_INPUT.json --output NEW_COST_PLAN.json
node scripts/competitions/v7/evaluation-registration.mjs --config FROZEN_PUBLIC_CONFIG.json --output NEW_REGISTRATION.json
```

登记 schema 为 `saitu.ranking-registration-config.v7.1`。固定 `algorithms:["B","C"]`、120×5、`reuseAlgorithm:"C"`、`candidatePolicy:"full_core_reviewed"`，业务模型为 DeepSeek Flash / thinking enabled / high。需登记画像 wrapper、800 输入 wrapper、挑战清单、迁移审查、固定画像切片、目录、候选池、源码、业务 runtime、公开 5 次准入及来源快照摘要；另有两个有限批次策略。初版执行器只支持已登记 `invocationConcurrency:1`。公开实测后如启用 2 并行，必须经过明确补丁、新源码冻结及复验；单 invocation 内 rank→explain→review 保持顺序。

`sourceSnapshotSha256` 是非排序事实/约束来源组件，`rankingSourceSnapshotSha256` 是完整排序池合法事实/来源闭包。两者必须明确分开，不将作者的来源组件遗漏误称为整个目录缺失。body 字节可用性与语义支持审核分开报告；扫描原件保留视觉阅读位置。

`runtimeConfigurationSha256` 使用 `evaluation-runtime.mjs` 的业务配置指纹，包含实际 provider/endpoint、Flash/high、从当前源解析的 prompt 版本、token/重试/超时/worker 并发及相关源文件摘要。`executionRuntimeConfigurationSha256` 单独保留原完整环境配置（含资金 run/phase/cap）。费用授权原件摘要 `authorizationPolicySha256` 与评分政策 `policySha256` 是不同含义；前者绑定批准文档原字节并与 DB/env 相同，不能强迫等于评分规则摘要。

## 真实 1,200 / 680 执行器

```sh
node scripts/competitions/v7/evaluation-executor.mjs --mode ranking --registration REGISTRATION.json --registration-sha256 SHA --input RANKING_INPUT.json --output NEW_RANKING_DIR --scope FINITE_SCOPE.json --e5-cache E5_CACHE --open --execute
node scripts/competitions/v7/evaluation-executor.mjs --mode product --registration REGISTRATION.json --registration-sha256 SHA --input PRODUCT_INPUT.json --output NEW_PRODUCT_DIR --scope FINITE_SCOPE.json --open --execute
```

恢复同目录在原命令加 `--resume`。每个槽位在调用前先写唯一 intent，完成后保存 observation 与 receipt；intent 存在而完成原件缺失时保持 indeterminate，恢复不重发。B 只使用固定本地 E5/BM25/RRF 和同一个 v7 context；C 直接调用实际 `rankDecisionV7` 与 `explainDecisionV7`，不借用 B 的输出。记录实际模型返回、transport dispatch、reservation 及 DB 账本原行。阶段调用数与推荐 invocation 数分开。

`invocationConcurrency` 仅允许开跑前明确登记为 1 或 2。不同 invocation 最多两个并行，同一报告的 rank→explain→review 保持产品内部串行。单 coordinator 持有独占目录锁，checkpoint 单写且按固定槽位顺序展示；全部 worker settled 后才可封存最终 manifest。只有显式提供旧锁原字节 SHA、同主机且 PID 已死亡，才归档旧锁并接管；异主机或未知状态不接管。有限 batch token 在新 intent 前同步分配，并与生产 PG 费用总账双控。预算耗尽保留已完成、失败、未派发原件；只有证明未派发的预算拒绝才能在显式新资金 scope 继续，任何已派发失败或无完成原件的 intent 均不重付。

输入为 JSON wrapper：排序 `{origin:"ai_authored_sealed",asOf,profiles:[...]}`；产品 `{asOf,cases:[800 rows]}`。旧 JSONL 保持不动，另导出 wrapper 后冻结其原字节 SHA。每行保留 `caseId/familyId/templateFamilyId/taskGroup/layer/operation/input`。排序 `input.profile` 必须与画像行完全一致。其他 680 题只允许下列实际路径：

| operation | input | 实际产品路径 / output |
|---|---|---|
| `constraint_check` | `profile` 或合法 `legacy`，可带 `targetItemIds` | `buildDecisionContextV7`；返回完整 profile、candidateItemIds、excluded |
| `fact_check` | `profile` 或 `legacy`、1–3 个真实 `itemIds` | 对指定项调用实际 `explainDecisionV7`；不额外进行排名，返回完整 report |
| `extract_profile` | `utterance/requestedFields/context?` | `extractSelfReportedFactsV7` 原样路径 |
| `conversation` | `profile` 或 `legacy`、1–12 个 `{text,itemIds?}` turns、显式 `prepareReport?/rerankAfterUpdates?` | 每轮实际 `draftDecisionChatV7`，保留逐轮 reply/profile/context；需要时才显式 rank/explain |
| `robustness` | `base:{operation,input}`、`perturbed:{operation,input}` | 两边分别执行以上真实操作，保留 baseResult/perturbedResult 及各自 observed/input_rejected/execution_error、错误、事件范围和时间；一路拒绝不丢另一完成原件 |

显式 canonical 提交在执行边界使用生产 `materializeStructuredProfileV7`，绑定完整输入 SHA 与 `/profile`（变形对使用各自实际 pointer）。旧事实缺原话时，只把其值本身的确定性词面登记为本次结构化提交来源，保留前后 profile hash、逐 fact value hash/pointer；不从 label 扩写历史原话，不改变 value/state/evidenceLevel/confirmed。已有来源字段缺原话的损坏绑定拒绝。未知学段直接进入只用 canonical 的 V7 context，不伪造 legacy 身份。

新的 80 个变形对不自动证明原 PG 重启/并发/取消/replay 等专项故障情形。原题等量迁移及退出原因、另需真实 PG 故障证据均单列；不得声称这些情形被文本变形覆盖。

费用 scope 至少保存新 v7 grant、真实 run/phase、DB authorizedPhase/effort、有限 call/funding、批准文档原件引用/摘要、完整 execution runtime 摘要以及单独的评分政策摘要。执行器在真实 DB 校验这些元数据；不会创建授权或充值。

## 800 原件评分

每个新 key 的 `answerSha256` 为其 canonical hash。key 有作者身份及独立 key review；检查包括 hard_constraint、fact_accuracy、citation_precision、citation_coverage、correction_success、correction_isolation、valid_reason、counterfactual。profile 的局部 `profile_semantic_boundary` 不混入 robustness 的反事实指标。

实际输出复审每 case/repetition 一份，绑定 key hash、完整 observation hash、独立上下文、output JSON pointer/value hash，以及涉及事实/引用时的 source body hash 与逐字 quote。事实复审还需 `factAudit.complete/observedClaimIds` 和每个命题的实际 `claimText`；新增命题可用 `additional_fact:` audit id，不能忽略实际额外断言。

画像 `key.profile.expectedAtoms` 是穷尽原始参考；存在复合编码时用开跑前冻结的 `expectedSemanticAtoms`（绑定 key 内 pointer/value hash/span）。输出复审可提供 `profileAlignment.actualSemanticAtoms`（绑定实际 `/output/facts/…` 或 `/output/unknownFields/…`），覆盖全部原始条目，再做一对一匹配。未匹配 expected 为 FN，未匹配 observed 为 FP；不得用复合 field 的一次匹配吞掉丢失的否定、主体或限制。`manifest.profileSlices` 在看输出前固定语义成员列表，摘要写入 `profileSliceProtocolSha256`，不能沿用一个 cross_task 组或事后合并失败小组。

评分器通过 `evaluation-originals.mjs` 读取已登记的 challenge/migration 原件，以及 product-originals 索引和实际 producer 写出的 `execution-manifest.json`、680 原观测、独立收据/账本及评分材料，并与 bundle 对象逐字比较。内部 proof 绑定该 bundle/matrix/registration 的具体摘要；仅 parsed object 或合成 fixture 不会拿到 `rawOriginalBytesVerified`。

```sh
node scripts/competitions/v7/evaluation-score.mjs --open --registration REGISTRATION.json --registration-sha256 REGISTRATION_RAW_SHA --input BUNDLE.json --input-sha256 BUNDLE_RAW_SHA --ranking-run FROZEN_RANKING_DIR --freeze-manifest-sha256 FREEZE_RAW_SHA --output NEW_RESULT.json
```

CLI 先从独立、非敏感、实际已登记的 `REGISTRATION.json` 及其原始字节 SHA 读取公开 challenge/migration、开发排除主清单/补充输入和800逐题独审，完成最终冻结适用性预检，再读取包含 keys/observations/rankingGold 的私有 bundle 与 ranking 原件。缺少登记元数据、排除范围不完整、最终批准未成立或哈希改变都在私有读取前拒绝；不提供旧版跳过 flag。`REGISTRATION_RAW_SHA` 必须等于 bundle/frozen matrix 的 registrationSha256，不能借另一份合格登记开门。

公开预检完成前不会调用会读取任意 source member 的来源依赖 reader。之后仍复用原来源原件/root/absolute-alias同realpath校验；source 引用不能指向评分 keys/observations/等级文件。默认引用根是仓库根；独立证据目录可显式传 `--evidence-root EVIDENCE_ROOT`，所有原字节与路径约束照常成立，该选项不许可跨根重解释历史 snapshot。上面的登记文件是正式登记原件，不是未冻结的 registration config 草稿。本说明不授权执行正式评分或读取封存材料。

`saitu.product-originals.v7.1` 索引需带 `freezeBinding/producer/openedAt/executionManifest`，以及 `cases/keys/reviews/sources` 各原件引用。索引是新封存材料，不能覆盖实际 producer 的执行 manifest。结果即使通过评测门槛仍 `productAcceptance:false`，还需性能、模拟、签名候选、切换回退、稳定运行及账本核对等产品验收。

## 迁移与独立交接状态

- `evaluation/public-800-identities-v7.json` 只导出原 800 caseId/layer/input hash，无题文/答案。
- `evaluation/actual-input-pool-handoff-v7.json` 核对了 120 原输入摘要；旧 39→新 45，新增 6、移除 0、共同 39 的 contentDigest 不变。完整池变化与自述政策变化仍阻止自动继承旧等级。
- 独立输入审查 `evaluation-independent-review/input-applicability-review-v1.json` 逐 800 只读输入；作者在独立意见后实际改写，最终数以其安全交付和独立复审为准。旧输入保留不等于旧 key 已适用。
- `challenge-author/author-delivery.safe.json` 为实际新 800 / 非排序 key 的安全摘要；独立题钥审查未结束时继续 pending。
- `evaluation-independent-review/ranking-input-applicability-120.json` 只批准 120 输入与实际 v7 driver 的适用性，不是金标/质量/最终源码冻结批准。
- `checks/legacy-13-applicability-v7-v3.json` 保留旧 13 failed，含实际 runtime 替代 selectors，质量类另要求正式 800/1,200 原件评分达标；2 项旧完整性失败永不改写为 passed。required 集转换需独立逐条批准及实际替代证据，ops 单独维护配置。

公开第一批后最小工具补丁验证为 34/34 定向通过（`checks/evaluation-v7-post-public5-tools-final.json`）。0 模型的实际兼容预检 704/704 通过，包括 584 个未知学段 context 和原排序 120 画像；480 条缺原话事实经过上述生产适配，输入语义与已冻结候选成员保持不变。原预检曾误把新增来源字段算入语义差异，其失败报告保留，修正比较口径后的证据为 `evaluation/post-public5-tools/canonical-context-preflight-v3.json`。全局 typecheck 在当前并行开发的其他测试出现类型错误，单列给相应 owner，不能把先前 typecheck 成功沿用到最终冻结。

正式 800 与 1,200 仍未执行；公开样本在主控处单独进行，不能拼入正式分母。45 池合法 facts/source sidecar 已获独立限定复审；A/B 的完整金标专用包已分别获主控授权开启，保留原始独立判断，源码实现/财务批次变更不静默改金标绑定。算法作者不读取两份金标，仲裁只向第三上下文给真实分歧原件。source pause checkpoint 及逐改动脚本 before 原字节见 `evaluation/post-public5-tools/pause-checkpoint-v1.json`。
