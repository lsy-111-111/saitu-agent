# 续做合同与验收映射

本轮按用户确认的完整计划续做：AI替代验收、上线候选，不执行生产发布。原ZIP是需求与合同参考，不能将其中草稿示例或材料自检当成运行结果。旧 `verification.md` 与旧 `release-readiness.json` 是历史证据，未覆盖续做源码。

## 七类合同

| ZIP合同 | 当前V6实现入口 | 运行边界与兼容方式 |
|---|---|---|
| competition_record | `catalog-types.ts` 的 `DecisionCompetitionRecord`；`catalog-validation.ts` | 校验实体、12模块、来源与L2/L3，`catalog-review.ts` 另校验双审；结构等级不等于可发布 |
| student_profile | `contracts.ts` 的 `studentProfileSchema`、`studentFactSchema` | 签名问卷及确认更正由服务端构造；`canonical-adapter.ts` 保留原文、确认及撤销，旧V5投影不抹掉新事实 |
| profile_update | `profile-contracts.ts` 的 `profileMutationSchema`；`chat-contracts.ts` 的 `updateProposalSchema` | 提案绑定baseRevision，只有confirm_update才提交；`decision-state.ts` 加密保存并按generation CAS；retract保留审计关系 |
| match_plan | `contracts.ts` 的 `matchPlanSchema`；`validation.ts` 的 `validateMatchPlan` | 约束画像/目录版本、候选/角色、跨对象引用、同系列去重；语义支持另由核验调用判定 |
| recommendation_report | `contracts.ts` 的 `decisionReportSchema`、`decisionResponseSchema` | 服务端按冻结决策组装；5–10项与不足原因；V5响应和收藏按原版本继续可读 |
| verification_result | `validation.ts` 的 `DecisionValidation`；`model.ts` 的逐断言verificationSchema；`source-judgment-contracts.ts` | 确定性issues、模型支持检查、来源判断分别留证，不将合法JSON等同事实正确；失败/最多一次修复/回退记录在trace及观测中 |
| benchmark_case | `evaluation-contracts.ts` 的 `invocationSchema`；`acceptance-gate.ts` 的ChallengeManifest | caseId+输入hash+operation；题目/答案/来源/实现/配置分别冻结；公开96题与800封存分离；缺证据、U、not_run不得自动通过 |

上述文件均位于 `src/lib/competitions/v6/`，唯 `acceptance-gate.ts` 位于 `scripts/competitions/v6/`。V6并非逐字接受ZIP所有JSON字段；迁移保留的是来源、确认、撤销、版本、引用与核验的不变量，不把旧示例伪装为新报告。

七份可读取JSON示例位于 `artifacts/continuation-20261105/contract-examples-02/`，由 `node scripts/competitions/v6/export-contract-examples.mjs --output <新目录>` 生成。它们只使用公开合成合同夹具；已执行schema、匹配/报告跨引用及确认预算更新的真实函数重放。`manifest.json`列出每份原始字节哈希。示例不是真实赛事档案、付费模型结果或验收材料；也不包含可调用真实会话的签名token。

免费统一复验入口为 `node scripts/competitions/v6/verify-continuation.mjs --output <新目录>`，保留类型、lint、Node/Vitest、生产构建、覆盖及目录审计的全部日志与失败。它不执行生产部署或正式付费验收；真实PG/x64、封存题、模拟产品研究和真实模型性能有各自单独入口与证据要求。只读费用原始账本导出为 `node scripts/competitions/v6/export-spend-ledger.mjs --output <新目录>`，不会修改主run或释放未知占用。

运行来源与本地模型须显式打包：`node scripts/competitions/v6/package-runtime-assets.mjs --output <新目录> [--e5-cache <既有缓存目录>]`。该命令不下载、不调用模型，按固定E5版本及每文件hash核验后复制；另复制索引声明的原件、正文，并把运行索引重写为包内相对路径。`manifest.json`给出全部文件hash和安装后需绑定的来源根目录、索引及其hash，`verification.json`记录完整性检查。缺失来源仍列在`unavailableSources`，不能把成功打包视作事实审查通过。发布装配必须携带整个资产目录；Next自动tracing和单独standalone目录不足以替代这一步。

## HTTP与状态边界

`POST /api/ai/competition-recommend` 保留V5兼容；V6问卷修改使用 `decisionEdit`，只替换新签名问卷里实际修改的字段。`POST /api/ai/competition-chat` 使用 decisionToken、expectedRevision、requestId、有效同意及action；支持message、answer_question、skip_question、confirm_update、reject_update及事实/来源核验动作。

客户端不能携带可信画像或评测候选池。回复绑定requestId、profileId、baseRevision、profileRevision和catalogVersion；已撤销文本不进入新模型历史。候选排序实验的全池注入只存在离线执行器，不成为生产HTTP参数。

## 本轮不可降低的完成边界

- 严格参赛覆盖至少36/40；准备任务覆盖单独报告。资格、总个人费用或必要资源未知不得算满足。
- 45个不同系列L3须真实有效双审。旧摘要批准不适用修改后的正文；作者不能补造审者认证。
- 800题含120排序题，后者每算法5次；推荐运行数与match/verify/repair HTTP调用数分开。
- 正式默认算法及唯一主比较基线在开封前按协议预注册；失败后改实现须新的未见验收。
- 主run继续累计；总上限300元、校准100次/30元、仅现有资金、不充值。未知usage占用不释放。
- 当前整体验收未通过；`actualParticipants=0`，`productionDeployment=not_performed`。

逐项T01–T24完成台账及本轮证据入口为 `artifacts/continuation-20261105/task-status.json`。该台账是进度记录，不是验收签发器。
