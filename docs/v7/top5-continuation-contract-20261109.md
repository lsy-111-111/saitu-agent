# 2026-11-09 Top5 续做合同

用户在当前对话明确批准实施本方案。本记录追加新政策，不修改旧授权、合同、失败记录或封存标签。

## 产品与接口

- 新政策：`saitu.policy.2026-11-09.v7.top5`；新任务实现：`saitu.async.2026-11-09.v7.3.top5`。现有 API 路径和 responseVersion 保持兼容。
- 新任务默认5个不同系列；有意义候选不足可少于5并说明原因，不凑数。完整45核心候选及合法排除规则不变。真实排序与详情均最多5项，不能后台10项仅隐藏。
- 产品 rank/explain/review 先采用 low/low/low；画像、聊天、聊天复核保持 high。全部阶段及诊断 thinking enabled。
- 浏览器原始点击至名单 p95≤40000ms，排序硬截止60000ms；全部详情 p95≤120000ms，详情硬截止150000ms；ready展开p95≤1000ms。详情包含排序，失败留在分母。
- 旧 v5/v6 保存记录和10项 v7 结果保持可读；旧任务不追改已持久化的时限、政策或调用。明确新提交/重算才使用新政策。
- 共享合同由 C 唯一维护：`RECOMMENDATION_MAX_ITEMS=5`、`RECOMMENDATION_LIST_DEADLINE_MS=40000`（目标）、`RECOMMENDATION_RANK_HARD_TIMEOUT_MS=60000`、`RECOMMENDATION_DETAIL_TARGET_MS=120000`、`RECOMMENDATION_DETAIL_DEADLINE_MS=150000`（硬截止）。历史读合同不以新上限拒绝旧记录。

## 质量与验收

- 新版B/C均最多5项；nDCG@10退出新版产品验收。nDCG@5≥.85，主分组≥.75，Top5 Jaccard≥.80，C−B配对95%区间下界≥−.02。IDCG仍来自完整候选池，短名单不缩小分母。
- 事实准确率≥.98、引用精度≥.98/覆盖≥.95、关键覆盖100%；关键事实错误及硬约束违规为零；至少500个实际独立事实命题。画像F1≥.95/切片≥.90、更正隔离100%、有效理由≥.95、反事实≥.90。
- 两名全新 GPT-6.1 Sol/max 上下文各完成120画像×45候选盲评；原始α≥.70后才仲裁。开发人员不读取封存判断。
- 完整规模：800题、B/C各600份（排序题复用C原观测），12例模拟试用、60例复用B/C原报告对比、100次性能（桌面/移动各50）；最终全部必测、签名候选、隔离切换回退、30分钟真实稳定运行。不部署生产。
- 一例真实五项完整链路通过后，运行新独立五例；至少4例同时达到内容质量、名单40秒/详情120秒/ready1秒。不同批次不得拼接；旧10项诊断不得重新标为通过。

## 审核、费用与并行

- 稳定改动合并一次非作者独审，修复后仅受影响部分定向复验；复用未变且适用证据。机械哈希/路径/清单变化机械检查，不反复全量语义审核。低风险建议保留20%抽查；最终冻结做完整验证。
- 沿用既有主预算、资金上限及未知费用保护，不自动充值；需要扩大资金/模型/质量范围再确认。真实模型最多2并发，只由主控登记派发。未知结果不重复付费。
- 最多6个子agent，均gpt-6.1-sol/max；一文件一负责人。盲标阶段释放2个开发名额给全新评审，其余4路继续。

## 文件所有权

- A：`src/lib/competitions/v7/model.ts`、rank packet/envelope/profile相关代码及对应算法测试；B对model入口的修改交A接入。
- B：group/explanation/evidence/chat实现及其专项测试；不修改model.ts、store.ts、worker.ts或公共contracts。
- C：v7公共contracts、store/worker/submission timing/runtime binding、费用/AI接线/API及对应测试；不得自行发真实AI调用或修改共享资金账本。
- D：前端组件/恢复/收藏、tests/e2e采集器、对应UI测试；pilot/evaluation脚本归E。
- E：v7 baseline/evaluation/pilot脚本与对应评测测试；不读正式私有标签、不自行派发真实付费执行。
- F：ops/release/source manifests、package工具链（需要时先沟通）、目录来源审计与独立发布实验；不修改其他路生产文件。
- 主控：本合同、基线、所有权冲突、集成、真实批次和最终结论。基线保存在`artifacts/continuation-v7-top5-20261109/baseline/`。
