# v7 评测独立复审（2026-11-09）

复审者：`/root/v7_eval_independent`。本上下文不是产品实现、评测工具或新800题作者。只修改自身证据目录和本报告；没有改源码、旧金标、他人的测试或工具，没有付费模型调用、部署或外部消息。主控已授权独审新680道非排序题钥及对应原始来源；没有读取任何排名金标、其他盲审等级或产品排序名单。

当前结论是 **非排序680题钥语义通过，正式验收 pending**。两批公开5例各为0/5，分别拒绝进入后续阶段，不跨批拼凑。正式800/1200尚未完成；题钥语义通过、来源闭包通过和合成运行时探针均不能代替真实产品质量结果。

证据根目录为 `artifacts/continuation-v7-20261109/evaluation-independent-review/`。以下只签本上下文实际完成的复审，不代作者、盲审者或仲裁者署名。

| 已独立完成 | 证据与严格范围 |
| --- | --- |
| 合同及工具首轮审阅 | 已读实施合同、进度及 `evaluation-{policy,runtime,registration,matrix,migration,reuse,score,legacy-applicability}.mjs`；originals/executor持续复审 |
| 替代运行时初验 | `replacement-runtime-initial.json`，profile/algorithm/catalog/frontend共54/54；自身没有运行付费模型、PG或正式矩阵 |
| 原13失败逐条适用性 | `legacy-13-independent-review-initial.json`；原报告hash/13 selectors/失败消息digest一致。11项旧精确公式/问答合同可由v7行为替代，但保护仍需真实runtime及正式质量证据；2项历史冻结完整性失败继续failed |
| 旧文件保留 | `legacy-preservation-check.json`，20/20相关旧文件与初始实际dirty归档一致；未解析封存答案 |
| 原800输入逐题语义 | `input-applicability-review-v1.json`，512 replace/288暂retain；六层身份hash全部核验。这是初始适用性建议，不是新题钥签核 |
| 排序120输入实际driver兼容 | `ranking-input-applicability-120.json`、`ranking-input-runtime-validation.json`；原profile完整保留，经真实canonical adapter/context/pool路径，各题assessment含全部45。只批准输入兼容，不批准等级、排序质量或freeze |
| 排序来源v2限定闭包 | `ranking-source-v2-independent-review.json`：100源、200 raw/body字节绑定；13旧reading locators与原log一致；2扫描PDF明确visual；从全273目录按实际predicate/metadata筛45后精确重建公共registry（208facts/546claims/3稳定人群规则）。仅供盲包来源闭包，不是全100源新全文语义认证 |
| 第一批公开5例独审入口 | `public-admission-01-independent-review.json`；5真实rank派发、0成功、全部约29秒超时，无列表/理由。分母保留5，不把失败时长null算零或剔除。实际费用未知，不自动重试 |
| 第二批公开5例独审入口 | `public-admission-02-independent-review.json`、`public-admission-02-source-archive-verification.json`；source.zip及注册先归档。5原始真实派发、0列表，4超时及1原始invalid_output；随后未派发repair不算额外付费。未知4项保守hold与1项usage_estimated分列，未读取rank响应内容，原件未改 |
| 100请求性能producer | `performance-browser-producer-review-targeted.json`；独立15/15单测、7自身DOM/clock/CLI探针及两批实际失败入口负例。原始click时钟、10项DOM、失败分母及同源码/目录/政策的已通过公开5+独审receipt gate已核。仅producer准备通过；100真实请求未跑，公开0/5继续阻断 |
| browser dispatch小增量 | `browser-receipt-helper-independent-review.json`；发现并关闭有效receipt掩盖无原件dispatch_intent/unknown错误ledger的缺口；独立21/21单测及12/12元数据探针。必须有真实派发证明，所有潜在付费项仍核ledger；明确未派发repair保留不抹去真实原始派发 |
| 公开开发5与新800输入隔离 | `public-development-input-isolation-review.json`；实际比较5通用问卷语义与已读680+120输入；当前800逐条匹配本人实际阅读签，800实际input canonical唯一，120排序都有具体经历与限制。共享真实template聚类保留，不伪造800独立family |

| 新非排序题钥层 | 实际独审 | 当前钥语义结论 |
| --- | --- | --- |
| profile120 | 全部输入/原始keys及224个预分解semantic atoms；首轮问题后定向复读 | 120通过。`profile-key-review-targeted.json`；切片固定成员另核，产品F1尚未通过 |
| hard300 | 全部新字段/状态/原话语义模式及300目标成员键，按v7政策与3条独立核实人群规则另行推导 | 300通过，57人群/243明确限制与未知边界。`hard-key-review-v1.json`；actual producer兼容首轮失败及主控修后复验另列 |
| conversation80 | 80输入/490逐轮checkpoints完整阅读，2全局边界及1个保留旧状态问题修后定向复验 | 80通过。`conversation-key-review-targeted.json`；requested字段语义与完整profile revision范围明确分开，歧义数字旧候选标存疑 |
| robustness80 | 两路160个实际操作输入及80关系全部阅读；事实题变化后，2新pair的4个实际输入与键定向重读，78 input/key canonical严格相同 | 80仅语义关系通过。`robustness-key-review-targeted-v2.json`；另1条envelope仅补来源provenance已披露。旧fault名称不证明并发DB/HTTP回放/网络取消/费用重试故障覆盖 |
| factual100 | 普通实读500/500选中原子、43/43系列及相关官方正文/页；修后实读69替换、5保留谓词改写、60保留源选择收缩与最后4个原子 | 100通过。`factual-key-review-final.json`、`factual-targeted-binding-check-v1.json`；最终500不同命题、87 used源/168实字节文件绑定，115注册关键命题。仅1复合提交命题保留2源且分工明确、只计1次 |

累计 **680/680非排序题钥语义通过**，不是680个产品成功。独立可消费逐题签字分别为 `profile-key-reviews-120.json`、`hard-key-reviews-300.json`、`conversation-key-reviews-80.json`、`robustness-key-reviews-80-v2.json`、`factual-key-reviews-100.json`。普通题钥采用一轮独审、作者修改后定向复验；排名等级仍由全新两路盲审及第三方仲裁处理，本上下文没有参加等级制作。

最终事实input SHA为 `9a05e8ee538561bd207a2b9dfb335f28ce80da80b2f2aa4bce941e63200d4401`，key SHA为 `f0f14811fb817e231a510406171f9c848be4ff9a34a3ec9b7fb7001ac6e26d70`，来源SHA为 `ec4b2e7aba944e8d8d6b977aa7346a98654be7338ec87a318402bee8ddf9313e`。最后修订保留CFA当地kickoff截止及之后就业例外、FSC毕业七个月例外、工业国赛前件及第8页定位；CFA补写时引入的错年已按实际原件封面统一2024—2025。当前完整800输入文件SHA为 `2beade41e4702988db2e4f0efe37099c3ef33ab7af6d2bd2719eff6033ed4b29`。

| 发现 | 实际证据 | 当前状态 |
| --- | --- | --- |
| I01 正式评分原件provenance缺口 | 初始scorer不能诚实产生legacy transition所需verification | 作者新增originals loader/内部proof；主控最新工具独审receipt另签其实际范围。正式transition仍必须有真实达标原件 |
| I02 注册后challenge/migration改动仍能过纯fixture评分 | `synthetic-binding-probe-initial.json` | 作者加注册原件精确绑定；pure fixture不能退休真实质量门槛 |
| I03 缺680真实产品收据也曾被判通过 | 同一探针的680 receipt slots=0 | 作者新增原件绑定；正式800/1200未完成，不能宣称formal-ready或产品已通过 |
| I04 普通陈述/非标准更正漏采，以及未知陈述误当问句 | 初始3probe失败；修后公开新synthetic actual-function schema验证 | `synthetic-chat-applicability-retest-v2.json`，10/10通过、0provider，定向缺陷闭环；不是680质量验收 |
| I05 旧profile分组F1退化为一个template | 原120模板相同、cross_task | 作者预登记6语义slice及固定成员，已独立审成员；作者接线工具与主控工具复审另有证据。分组产品F1仍待正式结果 |
| I06 新680合法未知学段被旧adapter挡住 | `nonranking-context-preflight-v1.json`；532cases/584context slots全部抛 `canonical_profile_requires_confirmed_supported_stage` | 作者修为真实structured submission entrypoint，主控独立对同字节584槽复验、仅允许provenance补全后语义不变；见主控receipt。初始failed保留 |
| I07 鲁棒pair一侧错误丢失已完成另一侧产品结果 | `robustness-partial-error-probe-v1.json`，全新公开synthetic真实函数；base成功后超长扰动throw，整个pair未返回 | 作者分槽封存；主控独立复验原公开probe证明valid base与input_rejected扰动均保留。预期拒绝不等于业务成功，失败分母不删 |
| I08 性能producer未强制绑定已通过公开5独审 | `performance-browser-producer-review-initial.json` | root补read/hash/version gate，本上下文定向15/15及实际0/5负例通过；真实100继续blocked |
| I09 browser receipt忽略无原件的潜在付费状态 | 原共享helper的dispatch_intent/unknown错误scope负例会被有效receipt掩盖 | root修两集合，本上下文定向21/21与12/12通过；只批producer证据分类 |

事实500首轮的70指令不全是错误claim：含同义重复、合取分项再汇总、OR或无前件片段、编辑选例/来源使用元边界、模态/当地届次范围，以及正确费用事实的正文重绑。正确scope提醒留作额外边界检查，不充500。修后只剩1个2源明确分工命题，其他均1直接源；没有继承parent全集。100题均额外要求完整审计全部新增官方事实、关键断言、个性化理由、角色与下一步；500命题不是遗漏其他输出的许可。仅明确标示的低风险建议按预定20%抽样。

公开来源已独立核查Google三task PDF共13页（`google-pdf-public-source-review.json`）及两analysis PDF共3页（`google-analysis-public-source-review.json`），读取实际正文并目视全部页。工业规则第8页原PDF确有费用正文，已目视并核准明确标记的人工段落转写（`industrial-page8-source-review.json`）；两费用命题已精确绑定第8页七（一）（二）及转写body hash。空提取壳、capture/hash存在本身不等于语义支持通过。

原300旧qualify题的201作品规格可作为官方任务/交付边界种子，不能转化为能力举证、当前作品完成度或报名门槛。未知日期/资格不排除；学生明确自述直接采用、更正立即生效。原100事实题若只有100claim，不够至少500；可每题扩成至少5个独立、来源绑定断言，或由正式C输出的预登记抽样框补足，不能重复claim/citation或重复运行凑分母。

当前池旧39→45（新增6、移除0），共同39的内容digest一致仍不允许自动复用排序等级。共享真实template/聚类provenance保留；没有要求全部800伪造为独立family。排序120需要独立样本；新800与公开5的语义family/template隔离终审已完成，范围仅输入，不读排名等级。

required-set transition最终仍须绑定稳定适用性v3、真实替代runtime保护、冻结源码/目录/提示词/规则及真实800/1200达标原件。主控独立工具复审位于 `evaluation/post-public5-tools/root-independent-review.json`（SHA `c9183a4d1c78fdffb04388e9bef0ca599a06bfab4501c85c7558fc115fb17d0a`），签其自己实际的504行及锁修、35/35、原始alpha≥.70 gate、584同输入context及pair分槽修复；不冒充本上下文的复验，也不批准formal结果。两项历史冻结完整性失败永久保留failed。两批公开5分别拒绝；100请求性能producer限定通过，未付费执行。试用/对比、签名候选、切换/回退/稳定性均不在已通过范围。
