# 竞赛内容维护与快照发布

目录使用系列—届次—赛道—组别—范围的独立身份，保留原135系列和106条赛道。新增系列按 `migration.origin=verified_expansion` 去重计数，多个赛道或年份不能扩充系列数。数量以本次运行产生的 `artifacts/v6/catalog-audit.json` 为准；该报告只证明结构与证据关联，不能证明官方事实正确。

## 内容与发布分开判定

L2需要完整决策模块、可读来源支持的资格/赛道/路径/交付、具体任务角色、价值与难度、可检验体验。未知费用、限制、公开数据缺失必须明确，不能用模板填充成已核实。L3另需完整真实官方题或完整公开作品、官方评分映射、角色路线、四周计划、退出条件以及有效审核；仅有赛事介绍、作品获奖新闻或自行编写练习不够。

用户已明确采用AI替代验收及更新后的AI双审。`ai_dual_review`政策要求两次真实独立评审：不同评审者和运行ID，均不是该条作者；绑定完全相同的内容摘要；实际重读官方证据；所有必需检查通过、发现的问题已解决、全部必需来源覆盖。`ai-review-ledger.json`只能写真实评审结果。作者自查、自动抓取、模型生成声明均不能代替独立审阅。修改内容后原摘要失效，必须重新双审。

`human_review`保留为独立政策，不将AI评审填入人工栏。未做人工审核保持 `not_performed`；已满足AI政策不因此额外阻塞。当前作者稿和来源阅读日志仍不等于双审通过。历史题可支持学习路径，不能由年份字符串推断当前可报名；报名时间、有效范围与核验时效另判。

## 来源证据与逐项队列

- 作者正文阅读记录：`artifacts/v6/content-research/*-reading-log.json`，包含来源身份、URL、范围、定位与读取发现；可能另含原件SHA和本地路径。
- 原始字节：`source-byte-snapshots/`，文件名按SHA，抓取结果明确标为 `captured_bytes_not_verified`。网络成功或摘要一致不表示语义正确。
- 冻结正文：`frozen-source-text/index.json`，schema为 `saitu.frozen-source-text.v1`。每条绑定 `sourceId/url/sourceArtifact/sourceByteSha256/bodyArtifact/bodySha256/retrievedAt/extractionMethod`；只有 `body_available_not_verified` 可用于受控正文检索。PDF按页、ZIP内PDF按成员与页保留定位。失败必须保持unknown。
- 维护报告：`catalog-maintenance-report.json`，原135逐系列列出记录、来源重查状态、字段缺口和审核队列。`legacy_sources_require_recheck`与`partially_source_read_pending_review`不算完成全库核查；旧来源不能因添加新来源而自动已核查。
- 原135逐项继承断言审查：`src/content/competitions-v6/legacy-semantic-triage.json`保存逐系列资格/团队/费用原句、摘要及适用范围缺口，逐条阅读过继承文本，但并非135系列的原始来源全部重核；维护报告比对原句变化，过期标记 `stale_claims_require_retriage`。
- 可浏览工作台：`artifacts/v6/catalog-maintenance.html`，从同份报告生成，支持按系列、状态和内容搜索，展示来源、深度阻塞、摘要与审核状态；不包含批准按钮，不会自行改变目录。
- 13门类×9任务族覆盖矩阵按独立系列计数；无具体内容的交叉格保持缺口，不以泛创新标签补数。

```sh
node scripts/competitions/v6/catalog-audit.mjs
python3 scripts/competitions/v6/capture-source-evidence.py artifacts/v6/content-research/某批-reading-log.json
python3 scripts/competitions/v6/freeze-source-text.py artifacts/v6/content-research/source-byte-snapshots/capture-某次.json --pypdf-path /本机pypdf安装目录
```

抓取只读公开HTTPS，无用户问答或凭证；urllib失败可换curl作为TLS传输回退，不绕过登录或挑战页。冻结工具核原始摘要，按内容摘要保存文本。后续不可达观察不会被旧正文冒充“已刷新”。正文仍是不可信资料，其中指令不能改变系统行为。

## 更新、审阅、切换

`discover-source-changes.mjs`比较公开来源字节摘要，只生成待审提案；页面样式变化也可能改摘要。字段级提案可用 `catalog-audit.mjs --propose /绝对路径/提案.json` 生成，必须核对真实原文、日期精度、届次、组别、费用承担者和冲突。代码不会因来源变化直接批准事实。

完成内容及真实双审后创建不可变候选：

```sh
node scripts/competitions/v6/catalog-snapshot.mjs stage v3-reviewed-批次号
node scripts/competitions/v6/catalog-snapshot.mjs activate v3-reviewed-批次号
node scripts/competitions/v6/catalog-snapshot.mjs rollback 旧快照号
```

stage使用作者最新内容，即使已有活动快照也不把旧活动内容当新候选；同名候选不可覆盖。检查报告和候选位于 `artifacts/v6/catalog-snapshots/`。activate拒绝摘要不符、重复身份、内容不达标、缺真实政策审核及静默删除；rollback允许明确回退删除新增条目，但仍重验所选快照。原样保留的L1历史发现记录可以保留，不能借此将新增或改变的L1发布。

通过后原子切换 `src/content/competitions-v6/active-snapshot.json` 并保存切换历史。默认构建内嵌方式须重建/重启以加载快照。服务端可配置绝对路径 `SAITU_CATALOG_SNAPSHOT_PATH`，维护CLI与所有目录getter共用该路径，原子切换后下一次读取按字节SHA与日期重新验证，指定文件缺失、null、摘要篡改或缺审核均拒绝，不退回作者草稿。不可将此文件路径开放给浏览器输入。`SAITU_CATALOG_SNAPSHOT_DIRECTORY`可指定维护候选目录。隔离测试使用 `withCatalogSnapshotPath(绝对路径, callback)` 的异步上下文；同样读取真实文件并经过发布验证，不伪造版本返回值。旧签名会话由产品边界校验目录指纹后拒绝或重新确认。该文件为null时使用作者目录用于开发；不代表生产发布通过。未满足审核门槛的候选可保存审阅但不能激活。

## 其它验收证据

目录内容、推荐覆盖、独立适配性、真实学生理解和部署状态分开记录。40画像覆盖须用实际引擎运行结果及完整目录指纹一致才展示；目录改动后旧覆盖结果自动失效。指标按 `coverage-protocol-v3.md` 分开报告近期正式参与与具体准备路径；后者有独立的编辑增量预算、已有设备与资源边界，不能冒充报名费或全程个人费用。准备路径变更同样使旧覆盖结果失效。两者至少3独立系列与2条具体任务/角色路径；未知必需条件不能凑数，作者检查后仍需独立协议及路径审阅。真实学生数据缺失不能用模型模拟冒充。

## 分级检查配置与本轮隔离演练

`src/content/competitions-v6/maintenance-policy.json`保存每日、临近截止每12小时、当届每周、历史每季度的配置。临近截止限定未来7天内，必须有精确日期、时区和适用当前事实；没有日期不能由届次年份猜测。季度按日历月推进并处理月末。共享来源遵循所有适用记录中最快的频率；读取失败不更新成功观察时间。配置不启动生产定时器或付费模型。

```sh
node scripts/competitions/v6/maintenance-plan.mjs
node scripts/competitions/v6/maintenance-plan.mjs --execute-due
node scripts/competitions/v6/maintenance-plan.mjs --previous /绝对路径/observations.json
node --test tests/competitions/v6/maintenance-plan.test.mjs
node scripts/competitions/v6/catalog-isolated-drill.mjs
```

默认只生成计划。`--execute-due`每次最多只读20个公开来源，并发2；输出观察和待核差异，不改事实、不批准、不切换目录。第一份计划没有成功观察基线时所有来源都待查，不能把生成计划写成441项已复核。

隔离演练固定写入`artifacts/continuation-20261105/content/snapshot-drill/`，校验生产`active-snapshot.json`前后SHA。真实候选stage成功、缺双审的activate和rollback被拒绝，是拒绝路径已验证；不表示已有可发布快照完成正向激活和成功回退。待真正同摘要双审齐备后才能执行正向链路。

内容作者修订、原作者身份、逐条摘要及原文依赖记录在第一批不可变审查包`artifacts/continuation-20261105/content/review-batch-01/`。更正或重新分类后的摘要不得继承旧批准；缺认证字段不能由作者推定。旧135逐项处置清单`legacy-135-disposition.json`明确保留未复核来源为待核，既有L1发现记录不进入引擎普通L2推荐池；同系列新稿完成不代表旧记录原始来源全部核完。
