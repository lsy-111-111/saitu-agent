# 产品事实抽取与冻结来源核验入口

2026-11-05。以下均为正式聊天 API 调用的共享产品函数，不是验收专用推理器；本轮仅 mock 模型和真实本地 PostgreSQL 测试，没有付费调用。独立封存作者答案未读。

## 公共 runner 对接

- `src/lib/competitions/v6/extract-profile.ts`：`extractProfileFacts({utterance,context?,requestedFields}, options)`。返回 facts/unknownFields/fallback/error/trace。facts 保留完整 domain 路径、原文子串、否定/未知/条件/撤回；自然文本不自动确认。
- `src/lib/competitions/v6/conversation-observations.ts`：`observeProfileConversation({initialFacts,turns,requestedFields,checkpoints}, options)`。initialFacts 为 DomainFact[]；turns 为 `{id,text}[]`；checkpoint.afterTurn 接受 turn ID 或 1-based 数字（0 为初始）。一次模型调用提取各轮原子，再用产品 reducer 顺序生成每个 checkpoint，返回 states/finalFacts/fallback/error/trace。不能用终局状态替代中间轮次。
- `src/lib/competitions/v6/source-judgments.ts`：`judgeSourceClaims({seriesId,evidenceIds,editionScope?,sourcePacket?,claims:[{id,text}],question?}, options)`；`qualifySourceCondition({seriesId,evidenceIds,editionScope,target:{kind,field},facts,sourcePacket?,question?}, options)`。condition 仅回答一个条件，保留 scope/targetKind，不升级成整体报名资格。
- `src/lib/competitions/v6/model.ts`：推荐继续调用已有 `runDecisionRecommendation(profile,{context,method,...})`，各实验臂必须使用同一冻结候选池。
- `options` 共享 `signal/deadlineEpochMs/onUpstreamAttempt`。AI 统一走 requestAiJson，8192 token 预算、一次尝试、配置 fingerprint；本模块不独立配置付费客户端。trace 保留真实结果供统一账本统计，缺来源直接 unknown，trace=null、零调用。

## 真实产品入口

`POST /api/ai/competition-chat` 的现有鉴权、同意、token、expectedRevision、请求幂等与 CAS 边界适用以下 action：

- `message`：自然“核实/核对/查证……”进入冻结正文核验，前端显示判断、逐字引文、范围与来源链接；其他更正复用同一事实 validator。
- `extract_profile`：`{utterance,requestedFields}`；返回 unconfirmed extractedFacts，并在可形成唯一变更时返回确认提案。只有之后 `confirm_update` 才保存 canonical 画像并重算。
- `qualify_condition`：`{itemId,target,question}`；来源与当前画像都由服务端选择，不接受客户端可信正文/事实。
- `review_conversation`：`{turns,requestedFields}`；逐轮只读核对，返回全部 conversationStates。明确不自动提交历史批次；用户将要采用的更正发送并确认。

普通 A1 推荐 route 默认 method=rules；该路径不经过旧 v5 可选解释调用，完整确定性报告直接返回。模型分支仍受40秒模型/45秒总响应上限约束。独立事实核验/抽取属于用户后续请求，不阻塞 A1 首屏。

## 来源边界与部署资源

正文仅从 `artifacts/v6/content-research/frozen-source-text/index.json` 的服务端注册记录读取，且须与 catalog series/source/scope 对应，校验 body 和原字节双 SHA256。客户端 sourcePacket 只能限制/否定范围，不能提供可信正文。metadata only、撤回、冲突、hash 不符、正文缺失都为 unknown。冻结可读不等于独立事实审阅通过。

默认根目录是 process.cwd()；可显式设置 SAITU_FROZEN_EVIDENCE_ROOT 与 SAITU_FROZEN_EVIDENCE_INDEX。部署时必须打包索引及其引用 bodyArtifact/sourceArtifact，或挂载只读证据目录；动态 fs 路径不能假定 Next standalone 自动收集。loader 禁止越出根目录和 author-private 路径，读取有大小限制。

复合来源使用明确 sourceScopes 绑定：sourceIds 唯一，绑定精确双射，每个 scope 与原始 source.scope 相等；需要 fact.entity 与记录 identity 的 edition/track/group/scope 四维一致。旧单范围事实仍维持全等检查，不因复合扩展降低原校验。

## 验证与剩余验收

新增 product-evidence mock 回归覆盖域字段、未知/否定、他人引语、兴趣不冒充能力、条件计划、逐轮撤回、跨请求结果、来源缺失/双hash/范围、条件限定、确认前不写画像。真实 PG 测试覆盖密文、损坏认证、竞争 CAS、提案/确认/重放、抽取未确认、陈旧版本拒绝。

这些测试不代表真实模型质量或 sealed 800 通过。实际付费模型质量、800 runner 与预算账本仍由主线程统一执行。旧 gold 独立重评输入包位于 `artifacts/v6/legacy-review-20261105/`，原冻结标签/断言未修改，待独立审阅。

最终本轮验证：15文件79项全部通过（RUN_DECISION_STATE_INTEGRATION=1，含真实本地PG3项），全仓tsc通过，所改产品文件ESLint通过。真实Chrome桌面与移动完整流程2项通过；从发出推荐请求到完整A1报告可见分别878ms/364ms，均0模型调用。计时为本地开发服务、mock问卷、临时安全状态，不含人类答题时间，也不是生产性能承诺。证据：`artifacts/v6/product-browser-20261105/a1-timing.json`；完整Playwright JSON `/tmp/saitu-product-timing.json`。测试自动服务已退出，3111无监听；未操作原3000服务。
