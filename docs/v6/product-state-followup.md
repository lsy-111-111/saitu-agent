# 2026-11-05 产品状态补强交接

本页记录本轮已经完成的产品实现与验证，不代表全量内容/算法实验已验收。所有模型验证均为 mock 或截获 requestAiJson，未发起付费调用，未部署。

## 统一 A1

2026-11-06续做已将`src/lib/competitions/v6/native-score.ts`对齐原计划的五维基线：目标30、任务25、具体经历20、准备15、成长10。先前七项25/20/10/10/20/10/5仅为历史开发实现，旧实验不可用于此配置的正式验收。具体任务优先于兴趣，自述技能不变成个人经历；成长依据期望产出，未确认目标保持未知。准备维的时间、周期、前置条件和预算分别保留未知份额；只有完整、当届、同范围的个人总费用证据才能支持预算适配。所有候选使用同一公式，排序不读取seriesId、迁移来源或旧分数。旧`candidate.score`仅供既有赛道资格兼容，不能给新增系列打零分。明确任务负偏好同样作用于新增系列。

兼容V5评分同时修正：缺少已确认的具体任务与本人贡献时，技能、奖项或团队成果不再产生确定的20分经历项。只有任务匹配、本人贡献明确的经历进入此维；未知下界为0、上界为20，不代表能力为0。旧金标原字节和失败保留，由独立迁移审查区分版本政策与真实缺陷。

测试包括真实旧 scorer 条目与仅改变身份的新增副本分数完全相同，以及新系列有更多匹配依据时排在前面。规则权重为可复现基线，最终算法仍待真实受控实验决定。

## 问卷编辑保留 canonical 会话

`POST /api/ai/competition-recommend` 增加可选 `decisionEdit: { decisionToken, expectedRevision, changedFields }`，只允许 v6。前端记录实际改动的控件字段，经历细分到每段的任务/贡献/完成/困难；服务器从新签名问卷取值，只替换这些字段。不会接受客户端 profile，也不允许用问卷入口伪造 eligibility/qualification 补充字段。未改事实保留原 ID 和来源；旧值进入撤销记录。服务端校验旧会话 generation/revision，并在原加密状态上 CAS 更新、清空过期提案和历史，返回新 token。原请求重试可精确返回；旧 token 的另一修改返回 409。

聊天新增的年龄、资格确认、负偏好、预算等不会被旧问卷签名静默抹掉。重新开始才主动丢弃原 canonical token。

## 动态追问和历史隔离

聊天新增 `skip_question: { questionId, disposition: 'skipped' | 'unknown' }`。加密状态保存 questionId、field、catalogVersion 和选择；同一目录版本下，其他候选对同一字段也不重复追问。用户可以继续自由补充，目录有实质版本变化时可重新评估。跳题/不确定不写学生事实、不推断资格；UI 提供两个按钮。

`historyRevision` 隔离模型历史：只有当前画像版本历史进入提示。聊天确认画像更正、旧问卷修改后清空历史；提示剥除画像 updates 审计原文。真实 prompt 截获测试验证撤销原文同时存在旧 history 和 updates 时仍不会传出。chat 使用 maxTokens=8192，promptVersion 包含统一 AI 配置指纹。无效更正补丁返回具体澄清，不写入状态。

所有新增状态都位于既有加密 JSON 内，不新增数据库列或迁移。

## 验证

- 产品回归 10 文件、51 测试通过；后补一条新增系列负偏好测试，native-score 共 5 项通过。
- 真实本地 PostgreSQL 加密读写/CAS、mock-AI HTTP 确认链 2 测试通过；仅测试行已主动过期，由维护清理任务删除。
- 桌面/手机 Playwright 各 1 次完整流程通过：新手问卷→报告→旧问卷编辑→自由比较→预算确认→聊天补年龄→旧问卷改预算→保留年龄原事实 ID→收藏。未捕获页面异常。
- tsc --noEmit 与本轮变动文件 ESLint 通过。
- 测试使用 3111 端口，测试服务已自动退出；未触碰原 3000 服务。

运行 Node：`/Users/jiumian/Library/Application Support/Codex/artifact-sessions/runtime-generations/generation-vSQd0h/runtime/bin/node`。

核心命令（以 NODE_BIN 指向上述路径）：

```sh
"$NODE_BIN" node_modules/vitest/vitest.mjs run tests/competitions/v6/native-score.test.ts tests/competitions/v6/questionnaire-edit.test.ts tests/competitions/v6/decision-chat.test.ts tests/competitions/v6/chat-prompt-isolation.test.ts
RUN_DECISION_STATE_INTEGRATION=1 "$NODE_BIN" node_modules/vitest/vitest.mjs run tests/competitions/v6/decision-state-postgres.integration.test.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "$NODE_BIN" node_modules/@playwright/test/cli.js test competition-decision-v6.spec.ts --config=/tmp/saitu-product-qa.config.ts --grep 'quick novice'
```

目录的总量、AI 双审和固定旧135系列不变量由目录负责人更新；本轮没有删除目标验收断言。最终全仓测试、真实模型校准和上线准备由 root 汇总。
