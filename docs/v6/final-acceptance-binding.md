# 完整候选 C 与独立审核工具 V 的最终产品消费合同

此入口只消费产品验收证据。`bindingValidated` 与 `productAcceptancePassed` 是两个不同结果；不输出 `releaseCandidateApproved`。**尚未接上工程发布证据的统一入口**，后续控制者 wrapper 必须不可选地同时要求本 K 的产品通过和既有工程发布证据通过，并核对同一实际交付候选及实际交付构建。旧 v5 release consumer 保持原样，旧流程通过不能充当 V6 产品通过。

## 四个对象与控制者 K

- C：执行与交付候选，按现有 `sourceManifest` 成员协议完整扫描 `src/db/scripts/ops/public` 和固定配置，包含全部 acceptance/ops 脚本。C 冻结后不回写审核登记，不排除工具文件。生成的 next-env 属于原有构建产物协议，不能通过改变 manifest 规则隐藏源码变化。
- E：完整原始证据目录，包含原始 acceptance 输入、challenge、1800 矩阵、选定 600 复用及其他 680、原始评审、catalog/runtime/build、ledger 等。K 固定 E 的完整文件集和字节；不是 caller 汇总结果。
- R：隔离 AI 上下文的真实独立审查材料目录。固定报告与完整目录，报告绑定 C/E/V。两个名字或 JSON `approved` 字段只满足结构，不能产生权限。
- V：独立审核工具包。允许使用与 C 不同的审核工具代码，并在此独立副本有限登记 exact 原始评分 envelope。不得将事后 V 变更并回 C 后继续宣称 C 没变。
- K：控制者独立审查后冻结的消费器副本。其私有 `TRUSTED_FINAL_BINDINGS` 固定控制记录的 exact byte SHA；记录递归固定上述所有身份。源码内实际登记表默认空。只有真实独立交接后控制者副本才可入册，不接受输入、环境、侧车 JSON 或 CLI 参数替代。测试中替换表的临时副本明确标记 SYNTHETIC-NOT-AN-APPROVAL，不能入实际可信表。

K 的信任来源是已授权的共享文件系统下隔离 AI 审查与控制者交接。控制者先审 K 的完整字节、其有限登记、V 和 R，再在启动前核对固定 K 清单/hash。K 不内嵌自身未来 hash，不增加递归启动器、服务器、人审或密钥设施。这是流程信任，不能抵抗同权限写者任意替换控制者程序的攻击；不得将输出自身报告的 K hash 当作独立批准。

## 可运行 K 包与启动核对

K 包必须是独立目录，完整文件集恰好为下列三项，所有依赖仅 Node 内置模块：

```
ops/bin/verify-v6-product-evidence.mjs
scripts/competitions/v6/final-acceptance-binding.mjs
scripts/competitions/v6/final-acceptance-worker.mjs
```

控制者将已审的原始字节物化到独立 K 目录，保存包含这三项路径/SHA 的完整清单及其 exact hash 在 K 之外的独立交接记录中。启动前用独立工具核对清单自身 hash、成员全集、逐项原始字节和固定 Node executable 的 version/SHA；启动后再核对同一清单。禁止使用被测 E 供应的批准 hash。新专项测试实际执行这一顺序，保留启动清单、native CLI 原始结果及完整动态 V 闭包；修改 K 后不启动。

用已经核对的固定 Node 绝对路径、清空环境后启动：

```
env -i NODE_ENV=production /absolute/reviewed/node /absolute/frozen-K/ops/bin/verify-v6-product-evidence.mjs \
  --record /absolute/control-record.json \
  --candidate /absolute/unchanged-C \
  --evidence /absolute/frozen-E \
  --reviews /absolute/frozen-R \
  --verifier /absolute/frozen-V \
  --output /absolute/separate-output/result.json
```

这些路径只定位对象，不授予信任。只有 record 字节命中 K 内部私有登记才继续运行 V。无 trusted-hash、approve、entrypoint、skip、policy 参数，也不读取环境中的审批。record/输出都不能作为源码成员；输出禁止落入 C/E/R/V/K。对象间目录必须分离，路径组件和所有成员拒绝符号链接、特殊文件、重复路径、未知字段/成员。前后再次核对每棵冻结树和目录设备/inode，不能切换目录后沿用旧结论。

## 控制记录与桥接

`saitu.final-product-binding.v1` 固定以下字段，不接受附加字段：

- `candidateFiles, evidenceFiles, reviewFiles, verifierFiles`：排序的完整 `{path,sha256}` 清单。C 使用现有产品成员协议，其余使用目录完整文件集。
- `node`：实际启动 V 的 Node `version,sha256`。
- `input,review,rawScoring,catalog,rankingRuntime`：相应目录下原件 `{path,sha256}`。
- `performance:{evidence,runtime,build}`：性能派生 envelope、其原始 runtime 配置及原始 build inventory。
- `budget:{evidence,snapshot}`：预算派生 envelope 和其原始全账本快照。

R 报告为 `saitu.final-product-independent-review.v1`，字段 `mode=ai_proxy,status=approved,isolation=separate_contexts_shared_filesystem,contexts,candidateSha256,evidenceSha256,verifierSha256`。真实审查材料的内容与隔离来源必须由控制者独立审查；这些字符串不自证独立性。R 的完整字节通过 record + K code-pin 固定。

K 在实际候选 C 上重新扫描并比较完整执行清单，同时核对 input.challenge、产品 registration/source before/after、矩阵 implementation 指向同一 C。目录清单 canonical hash 与文本文件 byte SHA 分别计算，不混用。catalog 与 ranking runtime 必须是矩阵内同一个原件并匹配产品登记；性能 runtime/build 必须是两项性能 metric 引用的原 envelope 内原件并绑定 C；预算 envelope 必须是 input.budgetEvidence 内同一全表 snapshot。所有 E 原件全集在执行前后重新校验。

此处 build 身份是**实际性能采集的原始 build inventory 与对应字节**，不是对尚未建立的 Linux 交付包构建身份做推断。最终工程 wrapper 仍须桥接实际交付 build/工程 release 包与 C，不能把 `bindingValidated=true` 升格成发布批准。

## 固定 V 入口与实际动态闭包

K 只调用 V 中固定 `scripts/competitions/v6/acceptance-gate.ts` 的 `evaluateProductAcceptance`，不复制评分或预算逻辑。V 的正式导出、全部现有门槛及原始派生器按原协议重算；所有尚不支持的指标继续 pending。

V 在独立 native Node 子进程中运行，cwd 固定 E。继承环境完全丢弃，只传固定 `NODE_ENV=production,TZ=UTC,LANG=C`；原始公开 runtime 配置作为绑定原件读取，不转成进程环境，也不转发 secret/key/DB URL。K 拒绝自身 loader flags、NODE_OPTIONS 和 NODE_PATH。控制者清空环境的启动操作必须发生在 K 进程创建前，因为任何 Node 程序都不能事后撤销在自身启动前执行的恶意 preload。

同步 Node module hooks 对每一次实际解析/加载检查：允许 Node 内置模块，或 V 完整清单中原字节匹配的 JS/TS/JSON 文件；拒绝外部路径/URL、query/hash、未知成员及 native `.node` addon。第三方依赖（当前纯 gate 为 zod）必须物化进 V，不能直接保留 pnpm symlink。package.json/JSON/源码和所有其他依赖文件在前后全树核对；输出实际加载文件/SHA receipt。该协议固定使用 Node 24 的原生 TS 处理，不开放自选 loader 或测试例外。固定 Node 二进制 SHA 是运行时身份，测试不替代将来 Linux runtime 的独立登记。

V 抛出任意值、返回 null/非法结果、非预期退出、超时、异常输出、修改冻结树或 cwd，均不能通过。正常 gate 的非零 pending 原样保留；产品通过还要求 gate 全部通过、原始 execution/budget 都 derived。K 输出不具有部署操作，也不改变预算历史、任何门槛或实际可信表。

## K-CLOSURE-01：明确 package scope 与 metadata 闭包

V 根必须物化并登记 `package.json`，其完整 JSON 内容固定为：

```json
{"name":"saitu-reviewed-verifier","private":true,"type":"module"}
```

这是实际 Node package scope，不是 loader 强制把 `.ts` 当 module 的补丁。未知字段、改变 type/name、自引用 exports 或 imports 都在执行前拒绝，不能继承 V 外祖先 package.json 的 type/name/exports/imports。每个依赖包的 package.json 仍按原文件字节物化、冻结；不是只登记最后执行的 JS 文件。

K 在调用 Node 默认 resolver 之前检查导入属于 V 内文件或 V 内有已登记 package.json 的 bare package（包括已登记包自己的 exports 自引用）。缺失的包不会继续向 V 外的祖先 node_modules 查找。所有 package.json 在运行前读取并校 hash；其 main/exports 目标不得逃出登记 package scope。当前纯 gate 不使用 `#imports`，此合同明确拒绝该能力及 imports 字段，不提供 fallback 或任意 resolver 旁路。若未来审核工具需要该能力，须单独扩展并独审合同。

bare package 还必须有已登记 exports 映射（当前 zod 满足），不启用可能继续向祖先 node_modules 搜索的 legacy main/index fallback。原包字段仍保留完整字节，不通过重写第三方 package.json 的方式掩盖不支持的解析行为。

顶层 `exports:null` 与缺失 exports 都不能作为封闭映射，bare dependency 和 package self-reference 两条路径均在交给 Node resolver 前拒绝。映射内部的 `null`（例如 `{".":"./index.cjs","./disabled":null}`）仍保留 Node 禁用该子路径的合法语义；不是把所有 null 递归禁掉。

输出增加 `verifierPackageMetadataFiles`：它列出全部冻结 package metadata，而不是声称 Node 的模块 load 事件能观察所有内部 metadata 读取。K 对该清单与 V 的完整 package.json 成员全集做一致性比较。现有 JS/TS/JSON 动态加载检查、全树前后校验和未知导入 fail-closed 仍保留。

祖先 type=commonjs、name=zod+exports、自引用 imports 等回归在同一已登记 C/E/R/V/K/Node 字节下运行，判定和加载 receipt 不变。缺根 package、篡改依赖 metadata、外部 bare package、imports alias 与越界 main 都拒绝。此修复关闭的是未登记祖先配置导致的不稳定 fail-closed，不声称曾存在整体错误通过，也不改变真实控制者必须审查 V 语义和 R 来源的信任根边界。
