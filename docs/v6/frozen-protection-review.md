# 既有冻结保护的实际差异

2026-11-05实施阶段再次读取所有冻结成员；此文件记录发现，不批准改哈希、不将失败标通过。

此前27项分为15项需求版本/标签、2项资格语义、9项完整性、1项前瞻基线。单个测试首先遇到首项哈希错误，会遮住其他差异，必须核对全部成员。

## 当前差异

金标manifest `tests/fixtures/competition-gold-freeze-manifest.ts` 与实际字节不同的成员：

| 文件 | 冻结SHA前缀 | 审计时实际SHA前缀 |
|---|---|---|
| tests/competitions/qualification-status-audit.test.ts | 9584146f4b54 | 554e658e9f4c |
| tests/competitions/recommendation-quality.test.ts | 0a2a0e0a7d54 | ff534bb2545a |
| tests/ai/competition-clarify-context.test.ts | 7fb965ef3dbd | ae4b07e73ac7 |
| tests/ai/competition-recommend-route.test.ts | c1e902569f83 | 605ae748de8a |
| tests/ai/deepseek-live.test.ts | 64e3e26faa13 | 1b90e8b237d5 |
| package.json | d1af29380ea2 | 0ff0d8eb186c |

发布 `ops/config/release-required-tests.json` 的sourcePins另有：

| 文件 | 冻结SHA前缀 | 审计时实际SHA前缀 |
|---|---|---|
| tests/ai/competition-ai.test.ts | 20998b842016 | e2228f57efe6 |
| tests/e2e/competition-recommend.spec.ts | 333b0e68f61b | 36527a4a8309 |

这些SHA是工作中快照，后续实现会改变字节；最终应重新完整核对，不能把本表当最终来源清单。

## 处理边界

先审实际差异及其测试保护：合法产品升级需要保留旧版本回放和新版本同等/更强断言；资格规则争议须对照适用原文及固定队伍/可调整队伍、缺资源/无法获得资源的成对例。修改评分实现以恢复真实不变量是修复；仅将期望写成当前输出不是修复。

金标已有 `evidenceDrivenSemanticMigrations` 与 `goldMethodMigrations`，允许基于证据的版本迁移。根manifest的信任锚点明确位于外部发布记录，仓内刷新它本身不能自证完整性。迁移应保留旧清单和逐条审查记录。

前瞻基线有正式 `scripts/capture-competition-prospective-baseline.mjs` 入口，最终代码冻结后可留存旧产物并产生新回归分母；其 `historicalComparisonAllowed:false` 必须保持，不能补造历史效果提升。

发布policy的整份SHA同时固定在coordinator与独立verifier内，最终root审批还核对独立管理员pin、已安装控制面和签名Linux证据。应准备可审阅的版本迁移与防篡改测试，不能仅同时修改两个常量形成自洽绕关。此次不部署，生产root批准保持未执行。

## 2026-11-05 固定付费验证器与共享预算迁移（待独立审）

本节是实现与测试记录，不批准发布、不刷新任何原信任 SHA。完整可审差异见 `artifacts/v6/linux-validation-20261105/fixed-budget-delta/review.patch`；差量成员及字节哈希见同目录 `source-manifest.json`。源码快照只覆盖列明成员，叠加 README 指定的旧 Linux 基线，不代表整个并行工作区的最终冻结。

### 为什么需要迁移

旧固定验证器使用 thinking disabled 和 500/1200 token，默认模型包含 v4-pro，且可独立于应用付费总账调用。用户已锁定官方 Flash/max 与总预算，因此这些旧行为不能作为验收载荷。此次固定请求均为 `model=deepseek-flash, thinking={type:enabled}, reasoning_effort=max, max_tokens=8192`，移除 temperature，单 HTTP 超时 60 秒。真实请求构造和请求 SHA 导出在 `fixed-request-policy.json`；其题面仅为原固定合成题，没有密钥或封存题。实际独立 verifier 程序通过合成 HTTP 执行，断言上述载荷；没有请求真实供应商。

### 保护变化与保持的边界

| 成员/边界 | 变更及保留的不变量 |
|---|---|
| `scripts/lib/release-evidence-deepseek-verifier.mjs` | v2 接受同一 systemd credential 目录下的 key 与 permit；先验 permit，再读 key。permit 精确绑定自身脚本 SHA、两个请求 SHA、Flash/max/8192、预占、主 run 与 10 分钟期限。一次进程内每操作最多一 attempt；不记录密钥、思维链或原始 provider body。HTTP 返回有效 usage 后，即使内容解析失败仍保留 usage。 |
| 新 `scripts/lib/release-evidence-spend.mjs` | 只用 Node 内置模块、固定 `/usr/bin/psql` 与固定 root 安装 verifier；不导入候选库、依赖包。root、固定 Node x64 路径、脚本路径以及 psql/service/policy 各层 root owner/不可 group/world write、私有文件模式与单 hardlink 均校验。 |
| 预算事务 | 必须找到已存在主 run，不 INSERT 新 budget。使用与应用相同 advisory lock `724310896145225`，所有 phase 的既有 charged/unknown reserved 都算余额；cap=min(DB hard limit, 300元授权上限, 真实funded)。calibration 仍 100 calls/30元，两个固定调用先原子预占。 |
| permit 生命周期 | root 0400、wx 创建；prepared→launched 在真实 PG 对两个绑定行原子 claim。复制旧文件再次 claim 失败；同 request/hash/row 不匹配整体 rollback。未尝试才能可信取消。已启动后丢日志、被杀、未知/矛盾 usage 全额保留。结算 SQL 类型/重复 ID 校验，已结算相同结果可幂等重复。 |
| `scripts/run-release-evidence.mjs` / `ops/bin/deploy-release.sh` | 两入口都先 reserve/claim，再向独立 verify 账号 LoadCredential。root coordinator 通过 env-i 调固定 helper；verify 无 DB 凭据、无仓库 verifier、不可读 `/etc/resume-ai`/PG/发布目录。保留原 IP 白名单、只读文件系统、NoNewPrivileges 等。退出后由 root 结算；cleanup 不因异常擅自退款。 |
| `ops/bin/verify-release-evidence.mjs` | 新预算 receipt 是必须签名产物，来源绑定固定 helper/verifier SHA、permit/run/request/日志 SHA、usage/价格。独立校验实际 attempt Flash/max/8192；未知必须全额，已知 usage 必须匹配 terminal。旧 Ed25519 信任锚和其他保护没有解除。 |
| 安装/配置 | helper 加入固定 control-plane 文件清单。新增 example 仅为示例，不安装含假值的真实预算策略；必须由可信管理员在 `/etc/resume-ai` 以 root 0600 配置真实主 run/余额/ledger-only PG service。构建/verify 账号不能持有 DB 权限。 |

`runId` 必须是包含此前调用的同一个主账本，不允许为固定验证另建 run。示例 funded=130.02 仅对应本轮已确认余额，正式执行前应由可信配置与实际主账本核对；CLI 的 run/phase/limit/funded 四字段必须逐项相等，不能仅看环境变量。服务配置必须连相同数据库；建议专用角色仅对两个 spend 表授 SELECT/INSERT/UPDATE，不能清理账本或操作产品表。示例文件不含真实凭据。

### 被迁移的测试断言

1. `production-ops.test.ts` 正常生产配置 fixture 从 v4-pro 改为 Flash/max，补显式既有 main run/300/130.02/calibration。所有原错误配置、权限、发布与 SQL pin 断言保留。
2. `release-required-tests.test.ts` 的合成已签名 Linux 产物集合增加 `deepseek-budget-receipt.json`。保留原“改 unit.log 必拒绝”，新增“改预算 receipt 必拒绝”。未改变固定 policy/toolchain pins，也未把假内容当真实预算成功。
3. 新增 12 条固定请求/permit/结算/独立 verifier 测试、7 条真实 PG 预算事务测试、2 条 Linux root/systemd 测试。并发 claim、已付费解析失败、原应用费用与未知预占累加均有实际回归。

### 12 个 ops 失败的处理结论

| 原失败组 | 结果与解除条件 |
|---|---|
| bootstrap 完整 ops 清单，1项 | **仍失败**。新增 helper、配置以及已有 ops 变更导致旧清单不符。需 fresh 独立审完整差异，之后经授权生成新的外部绑定清单；不能仅重算仓内 SHA。 |
| 只读 SQL pin，2项 | **仍失败**。root 已将加密 state/预算账本纳入真实表合同，旧 hash 尚未批准迁移。原 expected 与当前内容同时保留。 |
| package/toolchain/input pins，8项 | **仍失败**。包输入与旧审查清单不同。需审依赖、工具身份、alias 防替换、精确观察矩阵后迁移；不得靠固定成功结果替换测试。 |
| signed Linux artifact membership，新增1项 | **已修复 fixture 并通过**。原因是新增必须签名预算 receipt，旧合成集合缺成员。增加 receipt 篡改负例后恢复通过，无信任锚变更。 |

### 实际证据与未完成项

Ubuntu 24.04 arm64 / Node 24.20.0 / PG 14.24 本轮：普通 deployment **167 pass / 11 fail / 15 skip**；专门启用 PG 的固定预算组合 **19 pass / 0 fail / 0 skip**（12 单测 + 7 PG）；root 专项 **2 pass / 0 fail / 0 skip**。普通 15 skip 中新增 PG7/root2 已由专项解除，其余6仍按原平台/特权条件单独解释，不能隐去。报告在 `fixed-budget-deployment.json`、`fixed-budget-pg14.json`、`fixed-budget-root.json`。

首次 PG 运行发现 VM 重启后 PG 未启动，启动后发现旧隔离数据库没有预算迁移；应用真实 migration 并给隔离 runtime 正确权限后才得到通过。第一次通用 Linux 运行在默认 umask 002 下有3个临时 fixture 权限失败；按既有验证脚本 umask022 重跑后回到11个真实待审 pin 失败。不是修改产品安全模式接受 group writable。

本轮 TSC、修改文件 ESLint、shell语法通过。host/Linux 合成 HTTP 的上游付费请求数均为0。Linux root 专项验证真实 owner/mode/hardlink/祖先权限与 systemd LoadCredential，只使用合成 permit。**严格 Ubuntu22.04 amd64、固定安装 Node x64 路径下完整 root coordinator CLI、真实供应商付费 gate、30分钟正式 soak、生产审批/部署均未完成**；ARM 功能验证不能替代这些边界。实际 secret provisioning 仍在受信环境完成，不复制测试 policy 或模拟 key 到生产。

## 独立审 R1–R5 修订（2026-11-05，尚待复审）

独立审冻结结论为 `changes_required`，原补丁/审阅目录保持不变。本轮没有更新 bootstrap、SQL、package/toolchain/sourcePins 或两处固定 release policy 信任哈希。

- **R1**：普通 `reserveAiSpend` 不再 INSERT budget。新增 `ai_spend_authority` 单行（boolean PK/CHECK + run FK），由显式管理员绑定一个**已存在**主run；应用与fixed reserve/claim都核对authority。runtime对budget/authority仅SELECT，ledger保留所需写权限。共享advisory lock不变；移除需要UPDATE权限的budget FOR UPDATE，主预算/authority只能由管理员管理。故障hook只降低请求范围cap，不能建run/替换主run。测试admin创建独立临时数据库，绝不在真实主库切换authority。
- **R2**：实际requestAiJson不再clamp raw usage。所有计数须safe integer、非负，cache≤input、output≤本次maxTokens、input≤UTF8字节+1024。只有缺少缓存字段时按0缓存保守处理，显式null/矛盾值视未知。有效usage在内容解析前留存，坏content仍结算。真实共享HTTP路径（合成fetch）+真实PG覆盖了上述情况。
- **R3**：fixed settlement首次UPDATE及重复接受条件同时绑定id/run/request operation/model/effort/phase/price/reserved；重复结果以 `IS NOT DISTINCT FROM` 精确比较三个usage计数。plan的operation/reserved也必须与permit一致。PG证明同价不同usage拒绝、同结果可重复，以及第二行绑定被改时第一行更新整体回滚。
- **R4**：只读合同扩为12表，完整检查新表必需列、精确列白名单、全部现有budget/state CHECK（必须validated）、ledger/authority→budget精确FK。合法token计数例外保留，旧session/owner_token例外不变。PG14执行完整只读脚本，有效结构通过，11个结构破坏负例均拒绝。维护cleanup回归确认authority和ledger/budget都保留且维护角色无DELETE。
- **R5**：纠正此前“11项均pin失败”的概括。原VM bootstrap实际先被本任务测试生成的 `ops/bin/__pycache__/assert-apt-trust-contract.cpython-312.pyc` 拦截，**原报告未走到清单比较**。本轮仅删除此生成缓存和空目录，再单独重跑原bootstrap套件，才暴露真实canonical manifest字节差异。八个release-required-tests均先被package.json输入校验拦截，**八个下游alias/观察/伪测试/policy rewrite等断言本轮仍被遮蔽，不能声称已重验通过**。须经独立允许迁移后的候选快照重跑原负例和实际三报告。

### 显式初始化与升级顺序

1. 管理员应用 `db/migrations/20261105_spend_authority.sql`，不会自动推断或新建run。
2. 核对已有总账、授权上限和funded余额后，以维护的管理员PG service执行：
   `psql -X -v ON_ERROR_STOP=1 -v main_run_id='已核对的既有主run' -f ops/postgresql/initialize-spend-authority.sql`。
   此脚本拒绝不存在run或改绑，保留此前全部费用。不得用runtime账号执行，不得创建新的“验证专用”资金账本绕额度。
3. 按已审runtime权限清单重新provision，撤销budget旧INSERT/UPDATE并授authority SELECT。fixed账本service同样对budget/authority仅需SELECT、ledger SELECT/INSERT/UPDATE；root policy run必须与authority相同。
4. authority未初始化或运行配置错run时产品关闭付费路径，不自动修复。正式部署仍受外部来源pin/独立批准限制。

宿主本地已按本轮明确授权绑定 `.env.local` 中原主run；32条既有记录、8,568,524微元记账初始化前后完全相同，没有支付请求、无预算重置。该本地事实不代表生产初始化已执行。

新增原始测试及源码冻结材料位于 `artifacts/v6/release-migration-revision/`。严格Ubuntu22amd64环境工作由root另行负责；本轮不操作nested VM，ARM PG14功能结果不能替代x64固定CLI/root部署批准。


R1补充：普通程序的 `NODE_ENV=test` 隐式免账本也已移除。新 `tests/fixtures/mock-spend-ledger.setup.ts` 仅由Vitest配置加载，显式模拟无run且非live/非PG集成的纯单元测试；真实应用、普通CLI不会加载它。新独立Node子进程实际调用requestAiJson，NODE_ENV=test但无主账本时返回spend_configuration_invalid、HTTP次数0。相关189项单元回归通过；PG专项带明确integration开关，全部通过真实authority/ledger，不能被该adapter替代。此新增测试基础设施也必须进入复审来源清单。
