# v7 正式题集作者交接（2026-11-09）

本交接只列身份、路径、数量、来源与状态，不公开题目正文、题钥值或逐条预期结果。证据类别是 `ai_proxy`，未使用真实学生样本，也未宣称真人评测效果。

800 条实际输入及 680 条非排序新题钥已写入 `artifacts/continuation-v7-20261109/challenge-author/private/`。六层配额为约束 300、事实 100、排序 120、画像 120、对话 80、鲁棒性 80。画像和排序共 240 条保留原输入 canonical hash；其余 560 条按相同层替换。排序输入保留原 120 个独立 family、六组各 20 个；其 relevance 金标由另两位全新上下文盲审作者及第三仲裁单独交付，本作者未读任何旧排序答案、金标或产品排序输出。排序的另 120 条键只有政策与理由检查 rubric，不含相关度等级。

公开入口是 `author-delivery.safe.json`、`case-metadata.safe.json`、各层 `*-handoff.safe.json` 和 `migration.draft.safe.json`。这些文件保留原 caseId → 新 caseId、输入哈希与同层迁移 provenance。具体 bytes/hash 以当前公开交接文件为准；修订前的封存稿保存在 `private/revisions/`，不是正式执行证据。

题集只使用工具作者确认的实际接口：`constraint_check` 运行真实 v7 候选上下文；`fact_check` 解释指定的 1–3 个当前核心候选并返回真实 report；`extract_profile` 运行真实自报抽取；`conversation` 运行真实 chat 与画像更新；`robustness` 分别运行这四种路径的 base 与 perturbed 输入；`recommend` 只复用正式 C 的原始排序观测。未修改产品、脚本、测试，未调用付费模型或读取 API 密钥。

约束 300 条退出旧 `qualify` 的报名与作品达标门槛，改为可靠人群冲突、明确任务拒绝及不应排除的边界。采用已独立核发的 COMAP/Yau 共三条常设或多届人群规则。当前冻结池没有已核实的个人总费用数值下限，不制造费用超限正例；未知费用、日期与报名资格不会被标成不合格。

事实 100 条各预登记至少五个不同的可核验命题，并要求对实际报告全部新增官方事实、关键断言及引用进行完整审计。原子候选从源作者编写的官方事实中拆分，再回到冻结原文独立审查支持、原子性和重复；不能把逗号片段数量直接当作 500 个已通过事实。三个 Google PDF 查看器壳已用同一官方仓库的原始 PDF 正文补证，旧壳保留且不再当作题面正文。该类修正及其余源语义问题均由独立审复验，尚未完成的保持 pending。关键审计是 100%；真正低风险编辑建议单列后才采用预定 20% 抽样。

画像 120 条预先冻结完整请求字段语义与原子拆分，明确自报直接采用，保留主体、否定、未知、条件、撤回、数值与范围。未请求的旁及信息作为错误推断边界，不强迫抽取。`private/profile-slices.json` 预登记六个固定语义切片及成员；旧共享 family/template 聚类如实保留，不声称 800 条都是独立统计样本。对话 80 条保留原完整 turns 与逐轮 checkpoint 语义，仅按真实 v7 runtime 重新封装输入；必须实际经 chat 路径立即更新，不能绕过产品路由用 extractor 合并结果冒充对话通过。

画像 120 条新题钥的 224 个预登记语义原子已完成独立普通复审与定向复验，外部证据为 `evaluation-independent-review/profile-key-review-targeted.json`，SHA256 `5d796cdc9dbe9501ea77f40d9b34802a61f0404a75ee812adb7770f647c202bb`。约束 300、对话 80 和鲁棒性 80 也已完成独立语义阅读，两个联动鲁棒性输入已定向重签；当前逐哈希有效签名为 580/680，只剩事实 100 的最终定向签名。上述批准不代表产品画像 F1、切片或实际运行指标通过。低风险建议的采样 seed 预定为 `20261109`，当前人口 220、固定抽样 44 个 case/check 身份，完整人口与样本哈希记录在 `low-risk-sample.safe.json`；事实与关键断言保持 100% 审计，预封存修题后须在任何正式观察前重新绑定最终身份。

鲁棒性 80 条均为可真实执行的输入对照：28 个文本抽取、32 个对话语义隔离、16 个来源权威语义和 4 个未知费用/日期边界。它们不冒充旧 PG 重启、取消、并发写、响应交换或费用账本故障实验；这些正式专项仍须提供实际运行证据。旧 fault → 新同层输入的映射在封存的 `retired-runtime-fault-provenance.json`，未把旧结果搬成 v7 通过。

为保留复杂画像与逐轮对话语义，本作者先读取安全 runner schema，再用原 input-only 层身份 allowlist 从 `artifacts/v6/sealed-ai-20261105/author-revised-private/answer-keys.jsonl` 过滤提取 680 条非排序键；在解析前跳过全部排序行。来源文件 SHA、过滤规则及提取 SHA 记录在 `private/legacy-key-access-disclosure.json`。旧确认/举证规则与旧接受结论均不继承，全部新非排序键交 `/root/v7_eval_independent` 按 v7 与原始来源独立审核。

此稿仍是作者交付与独立复审中的封存材料，不是质量通过或发布声明。最终 `reviewBasis`、实现/运行配置/目录冻结哈希、独立逐题适用性与题钥签名及排序双盲金标必须绑定后，才能生成可执行正式 manifest。正式执行计数当前为 0/800 与 0/1200；源支持、画像切片、对话版本、原始浏览器时钟、失败分母、费用账本及其余产品门槛均不能由结构校验替代。

`official-source-references.safe.json` 是纯官方原文引用组件，不含问题、题钥、预期或相关度。当前 139 个 sourceId 绑定包含 135 个当前目录来源和 4 个常设人群来源；45 池共有 170 个不同 sourceId（172 次记录引用），本组件尚有 35 个目录 sourceId 未提供正文，不能冒充全池正文闭包。正式排序包与题集最终必须采用工具作者及目录作者共同冻结的完整来源身份。

双组件绑定在 `source-components.safe.json`：`sourceSnapshotSha256` 是非排序 680 题组件 `3ed211159079a9304d73e97b4f8d8d7af3dcb700361275751619549f5e4580a8`；`rankingSourceSnapshotSha256` 是排序完整 45 池组件 `12551561dfff1219fcabdad3eb9dee3f76e1fd79f297d78320b30c2ecdabe6e6`。matrix 同时绑定两者，排序 gold 只绑定排序组件；每题 metadata 采用自身层的组件，不将全局同名字段偷换成另一组件。

事实首轮的 70 项集中指令已实际处理，保持 500 个位置，换入 69 个真实不同命题并补全范围、条件、OR 和 should 模态；23 个事实输入及两个关联鲁棒性输入因此变化，其完整 provenance 和前版哈希均已归档。最后三处语义/范围限定与四个精确 locator 已小修，最终事实题钥 SHA256 为 `f0f14811fb817e231a510406171f9c848be4ff9a34a3ec9b7fb7001ac6e26d70`，来源 JSONL SHA 为 `ec4b2e7aba944e8d8d6b977aa7346a98654be7338ec87a318402bee8ddf9313e`，等待独立最终定向复验。最后小修没有继续改变 800 条输入。

实际 producer JSON wrappers 已另导出，保留原 JSONL；预备 `asOf` 为工具作者指定的 `2026-11-09T00:00:00+08:00`，仍须 root 最终统一后正式冻结。公开 `producer-wrappers.safe.json` 和 `wrapper-consistency.safe.json` 记录原字节哈希及一致性，800 产品输入与 120 排序输入全匹配，私有输出文件/目录权限已检查；后续生成继续采用 0600/0700。不得在最终登记后重新生成或静默更换 wrapper。

收到独审最终事实 rows 后，可只运行 `private/attach_key_review_metadata_only.py` 更新公开批准计数；该脚本只读公开 metadata 和外部签名行，不读问题、题钥或模型输出，不改 source/input/key bytes，也不重置迁移的冻结 basis。最终 source-only provenance 补全另见 `noninput-source-provenance-changes.safe.json`：12 条事实及 1 条鲁棒性只补/收缩 sourceEvidenceIds，不能将“canonical input/key 未变”误说成整个 envelope bytes 没变。
