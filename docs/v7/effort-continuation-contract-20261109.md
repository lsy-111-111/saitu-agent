# 2026-11-09 阶段档位续做授权与实施合同

本文件记录用户在本对话明确确认并要求实施的续做方案。它是新增授权原件，不改写此前 implementation-contract.md、费用授权、失败记录或封存材料。

## 已确认范围

- 完整发布候选：800题、B/C各600份、12例模拟试用、60例B/C原报告质量与理解对比、100次真实性能、全部必测、签名、隔离环境切换回退和30分钟运行。生产部署不在范围内。
- 六个子agent同时工作，均使用GPT-6.1 Sol/max；两路优先修复C。工作agent模型不随产品档位变化。
- 产品仍使用deepseek-flash、thinking enabled。rank/explain/review分别允许high/low公开对照；画像、聊天及聊天复核保持high。选定一个阶段策略后冻结，原质量与30/90秒性能标准不变，排序硬截止45秒。
- 不以两轮失败为停止条件；在现有主授权资金内持续登记有限批次。新增资金、更换模型或改变质量标准时再确认。不得自动充值。
- 一轮非作者独审加受影响部分定向复验，复用未变证据；低风险建议固定20%抽样，关键事实、引用、费用和隔离边界保留。
- 排序gold保留两名全新上下文各120画像×45候选的完整盲评，原始α≥0.70后才仲裁，不采用48作者分片。

## 新档位合同

`effortPolicy={version:"saitu.effort-policy.v1",rank,explain,review}`，各阶段仅high/low。统一解析并以version/rank/explain/review字段顺序的JSON原字节计算SHA256。它在任务创建时冻结，绑定任务、分组、调用、运行时和正式评测；修复调用沿用阶段档位。

新费用分支为`grant_version=saitu.v7.effort.v1`、`authorized_effort=stage`，保存`effort_policy`及`effort_policy_sha256`。新增条件使用`saitu.user-approved-budget-condition.v7.effort.v1`及`authorization=user-approved-20261109-effort-exploration`，绑定本文件原字节、主授权和阶段策略。环境使用`AI_SPEND_EFFORT_CONDITION_SHA256`；旧HIGH_CONDITION和旧max/high分支不被重新解释。

允许的请求操作为competition_v7_rank/explain/review按相应阶段，competition_v7_chat/extract/chat_review及competition_normalize固定high；隔离发布固定两请求预检的competition_recommend按rank。新授权不允许扩大到任意操作。所有调用仍使用同一主费用总账、真实余额减未知持有、有限调用与资金上界，物理受控并发最多2。

新调用指纹含实际thinking、reasoningEffort和effortPolicySha256；新实现使用独立版本，旧unknown不得通过换key/档位再次付费。旧授权、迁移和账本原件保持。

## 首批诊断及后续

首批固定公开材料：rank两档共2次、两组explain各两档共4次、两组review各两档共4次。10次初始，计入仅确定无效rank/explain的合法修复后最多16次，review无修复。派发前按最坏预占登记资金上界；质量审查隐藏档位与耗时。此诊断不是完整链路、正式质量或p95证据。

暂定组合随后验证真实完整链路，再以同一冻结配置运行新公开5例至少4例成功。正式执行和最终签署尚未完成时保持pending。模拟结果不等于真实学生效果。
