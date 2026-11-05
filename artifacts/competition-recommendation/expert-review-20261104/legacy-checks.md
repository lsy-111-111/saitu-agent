# 旧验收差异核查

2026-11-05 凌晨复核。按此前全仓运行的33个失败逐项记录，包括25项推荐检查和8项发布审核。旧专家标签和发布授权未被重新签署。

25个基础画像的同库/扩库对照见 legacy-positive-comparison.json。64题的工程性质、部分覆盖和人工待审分别见 engineering-coverage.csv。

| 原序号 | 检查 | 分类 | 核查结果 |
|---:|---|---|---|
| 1 | captures only when explicitly requested, then verifies the prospective baseline byte-for-byte | 旧评分冻结 | 旧 prospective 分数要求逐字一致。保留旧快照。 |
| 2 | freezes the benchmark clock and every literal fixture source | 发布审核 | 清单固定多个 verifier 源文件。响应、问卷、短名单契约改变，需要独立核查，未重签。 |
| 3 | keeps all seven dimensions inside their caps and derives base score from their exact sum | 已换契约 | 七维分值上限已更换为目标、任务、经历、准备、成长的五维。新旧快照分别校验。 |
| 4 | places at least 90% of gold pairs inside their human-approved base-score intervals | 已换契约 | 人工给出的旧七维分值区间不能替代新五维的独立审阅。 |
| 5 | keeps every audited cross-core transfer below the subject/task qualification gate | 待独立复核 | 跨学科不再一律限分；已确认任务和经历能支撑迁移，哪些弱迁移仍应降低优先级待核。 |
| 6 | passes 100% of the 104 mechanically label-derived ordering edges in production | 质量未达旧门槛 | 104项由旧标签导出的偏序仍有反转，不能视作新版排序已获专家认可。 |
| 7 | keeps the expert top choice and hard-negative gates while filling three unique items | 质量未达旧门槛 | 兼容画像的既有首选/可接受清单存在未命中，保留这些差异。 |
| 8 | recovers fixed mechanical/hardware alternatives after the target is hard excluded | 质量未达旧门槛 | 不符合全日制要求者不能获目标赛事；既有机械替代清单的前三命中不足两项，需评审新旧工程替代。 |
| 9 | prioritizes current entries, then unverified and next-cycle candidates for strict timing | 新契约已通过 | 开放、关闭、未知、取消以及近期意愿均不影响排序。 |
| 10 | preserves every legal recall candidate after 'empty/incomplete ordering' | 新契约已通过 | 保留候选唯一、资格和回退检查；资格未知者不再被固定排到最后。 |
| 11 | preserves every legal recall candidate after 'invalid JSON' | 新契约已通过 | 同上，非法 JSON 不能制造新候选。 |
| 12 | preserves every legal recall candidate after 'timeout' | 新契约已通过 | 同上，超时维持合规候选。 |
| 13 | preserves every legal recall candidate after 'provider unavailable' | 新契约已通过 | 同上，服务不可用时仍保留合法序列。 |
| 14 | pins exact dependency inputs and direct package/bin identities against npm alias substitution | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 15 | pins every selected source and covers the complete fixed release matrix | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 16 | accepts only exact passing observations from all three machine reports | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 17 | fails closed when a pinned test is changed into a trivial substitute | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 18 | makes both authorities reject a self-consistent policy mapping rewrite | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 19 | rejects missing, renamed, skipped, and incomplete required observations | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 20 | reproduces the coordinator receipt and rejects ambient dependency input | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 21 | accepts only the frozen Playwright path and run-bound project-tool output | 部署审核 | 依赖版本、文件摘要及测试签名不再与旧发布矩阵一致，须独立授权。 |
| 22 | uses the complete directory when a semantically supported candidate outside recall enters the final three | 新契约已通过 | 移除资格候选前十截断，追问模拟覆盖完整目录，保持资格快照。 |
| 23 | contains exactly 100 auditable anchors, 30 hard negatives and 20 no-match personas | 目录范围已变 | 100个锚点画像不能作为135项全覆盖；新增赛道保持未标注。 |
| 24 | meets fixed-question and true V5 full-path ranking gates | 质量未达旧门槛 | 25个旧基础画像中财税方向仍有未命中；分组门槛未达。 |
| 25 | has zero official hard-eligibility violations in all returned candidates | 队伍假设不同 | 旧检查将当前阵容视为不可变；新规则区分当前状态、可调整队伍和明确固定队伍。 |
| 26 | hard-excludes all 30 near-neighbor personas only through sourced structured facts | 资源假设不同 | 在显式指定不可变队伍或资源不可得后，30个原硬负例均排除目标。可补缺口不当作不合格。 |
| 27 | reaches no-match F1 = 1 without suppressing valid anchors | 实质回归已修 | 宽泛技能和愿望不独自支撑具体推荐；有具体任务证据的新手仍可获推荐。旧no-match F1和新手回归已过。 |
| 28 | reaches each track oracle through V5 and proves both emitted branches are distinct | 追问路径与质量待核 | 部分原赛道画像提前停止或先询问另一问题。需在新目录检查是否仍能问到重要赛道。 |
| 29 | keeps every authored question material and its own branches outcome-distinct | 追问质量待核 | 旧样例认为重要的问题未全部出现，其区分价值需复核。 |
| 30 | matches the authored fit and goal minimal member, relation and track oracles | 质量未达旧门槛 | 冻结的偏好最小分歧和赛道预期未全部符合，不等于新体系已达标。 |
| 31 | keeps fit and goal answers qualification-invariant across the complete frozen snapshot | 旧路径中断 | 先按旧题序取得检查前提时失败；签名/资格快照和偏好隔离另由接口测试直接验证。 |
| 32 | limits goal trade-offs to the authored 75/25 goalsOutputs refinement | 已换契约 | 旧取舍限定仅改变15分维度的25%；新主目标占30分，学校认定收益未知。 |
| 33 | allows reached track answers only from precomputed states and never upgrades needs_clarification | 旧路径中断 | 旧样例依赖预先到达特定赛道。正式接口另测伪造或不合格赛道拒绝、母赛和赛道资格。 |

当前 AI 和比赛套件可用 `pnpm exec vitest run tests/ai tests/competitions` 复跑，原始八月评分、题序和发布摘要会继续显示差异。新工程性质及30个硬负画像可用 `python3 scripts/check-competition-seed-coverage.py --run` 和 `pnpm exec vitest run tests/competitions/decision-fit.test.ts` 复跑。

### 九项既有系列补充赛道后的复查

九项系列追加44个带原文和适用范围的赛道、组别或作品类别。三条职业方向、农业方向回归暴露出通用“职业证据”与已确认职业规划任务混同，以及外来候选顺序可能被误当服务器顺序。修复后四条实时排序回归全过。原100个锚点的“每项在前十”新出现一个反例，即高职学生被预期推荐第19届中国大学生计算机设计大赛。正式规则要求在籍本科生，因此该锚点目前被明确排除。全并发运行曾使25个画像的完整追问循环超过单条测试5秒限时；同一冻结用例在单独复跑时通过（3.70秒），需分别看并发负载与资格结论。具体25例最终数值见本目录 JSON。
