# v7 算法独立复审（2026-11-09）

复审者 `/root/v7_algorithm_review`。在六个 agent 实际在线并收到 root 开始信号后读取项目；未读取 sealed/private 答案，未调用付费模型、提交 Git 或部署。以当前脏工作区为起点保留全部已有变更。原作者的测试结论不作为本次通过证据。

本次独立检查覆盖完整池构建、画像与撤回、明确更正、模型输出及引用验证、解释与追问复核、十项列表的串联调用，以及 v7 同池 B 基线适配。

|实际缺陷|修复与定向证据|
|---|---|
|同一条更正通过 `else if` 只采用一个字段，技能只采用首个命中项|按独立语句解析全部明确更正，一次写入；时间、个人预算、多技能否定/肯定及原始整段话同时保留。|
|数值字段撤回因缺少新数值被拒绝，技能撤回变成“不会”|撤回不经过新值类型检查；技能撤回删除旧断言并保留撤回 ID，不制造否定能力。|
|抽取 exact `weeklyHours` 后保留旧 `weeklyCommitment`；反向改 bucket 后保留旧 exact|两种当前时间表示同步替换，明确 unknown 保持 unknown；旧 ID 进入撤回集合。|
|全队/范围未知预算上限冒充个人上限|v7 分别保存 `budget.teamMaximumYuan` / `budget.unspecifiedMaximumYuan`；个人约束不借用这些值。小数个人预算保留在 canonical facts，旧整数适配只传合法范围。|
|“不做产品策划”硬排除软件/设计/调查等大类；“不做科研”排除全部数据任务|跨类编辑标签不作必然冲突；保留其原话交完整池模型比较，直接任务冲突仍可排除。|
|v7 个性化解释丢失 v6 必须引用赛事任务的验证|每条个性化匹配推断同时要求有效学生及赛事事实；拒绝非法 confirmed 状态、重复学生事实 ID。|
|模型可通过 suggestion 标签绕过规则/个人断言复核|新个人断言、规则/资格/费用/能力等事实口吻均进入一次批量支持复核。解释每项最多三条，每条 320 字，rank 内部依据最多 40 字，复核批次上界受控。|
|一般追问可以在无引用 message 中藏事实；新 claims 只有 ID 检查|message 仅使用确定引导，实质内容经 claims 展示；新关键 claims 一次批量复核，缺失/外来 review key 不视为批准。失败明确说明未得到可核实补充。|
|完整报告可重复 audit 行冒充全覆盖，比较行可带池外 ID|审计 ID 唯一且覆盖全部记录；比较维度行完整、唯一并绑定选定项，来源包仍逐字段核对。|
|低风险抽查只输出无内容的 key|事件包括完整断言/引用、profile/catalog 绑定、固定 seed、SHA-256 digest 和固定 20% 抽样算法；root 已接密文持久化，实际离线复审仍 pending。|

v7 B 适配位于 `src/lib/competitions/v7/baseline.ts`，供正式执行器显式调用。它消费 C 的同一个冻结 context 与候选乱序，不复用旧资格池或 candidate.nativeScore，不裁召回；沿用 BM25(k1=1.2,b=.75)、固定本地 E5 revision、RRF60、native-fit90/rrf10。新生自报直接来自同一 v7 canonical profile，未知继续保留区间。输出全池分数、维度/引用/unknowns、输入摘要与官方事实来源包；不可用 E5 时失败，不降级成其他算法。此 B 不参与产品 C 排序。

验证：八个定向文件共 **119 测试通过**；上述相关源文件与测试的 ESLint **通过**。完整 `tsc --noEmit --incremental false` 当前被并行新增的 evaluation `.mjs` 声明与 fixture 类型错误阻挡，已向其 owner/root 逐项报告，本次未覆盖该 owner 文件；不把全局 typecheck 记为通过。文件摘要见 `artifacts/continuation-v7-20261109/algorithm-independent-review/source-manifest.json`。

付费实测接口为 `buildDecisionContextV7(legacy)` → `rankDecisionV7(context,{deadlineEpochMs:firstSubmittedAt+30000,...})` → `explainDecisionV7(context,plan,{deadlineEpochMs:firstSubmittedAt+90000,...})`。不传 modelCall 时才使用真实模型。rank/explain/必要时一次 review 串联，十项解释已全部批量生成，ready 展开无需额外调用。30/90 秒实测、正式 800/1200、20%离线复核均仍待实际证据，不能由本次 stub 定向测试替代。

补充修复（root 独立指出的 ai-client 层默认 45 秒截短）：每次模型调用将同一个剩余预算同时传入 `timeoutMs` 和 `requestDeadlineMs`，并继续绑定原有绝对截止时间。新增 mock 时钟测试验证 rank 29,250ms、已耗时 12 秒后 explain 77,250ms、再耗时 10 秒后 review 67,250ms；详情和复核共同受首次提交后 89,250ms 限制，未重置 90 秒。当前算法文件 **21 测试通过**、变更文件 ESLint 通过；该执行配置变更已通知正式评测 owner。
