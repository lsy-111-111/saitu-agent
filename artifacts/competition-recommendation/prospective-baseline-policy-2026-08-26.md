# 竞赛推荐评分基线：历史限制与前瞻门禁

## 审计结论

`tests/fixtures/competition-score-baseline-v11.json` 不存在，而且没有实施开始时间 `2026-08-24T14:51:22.643Z` 之前的不可变源码和逐画像结果。因此，“相对 `deterministic-2026-08.v11` 平均提升 12–15 分”没有可信分母，**历史提升无法证明**。

本记录不使用事后重算、伪造时间或回填 v11 结果。结构化限制保存在 `tests/fixtures/competition-historical-baseline-limitation.json`；如果未来出现真实历史证据，必须另行做独立溯源审查，不会被当前测试静默接受。

## 替代门禁

获得明确授权后，历史 12–15 分主张不再阻断当前发布；它仍保持 `unprovable`，不得改写为“通过”。替代门禁是 `competition-score-prospective-baseline.v1`：

- 以真实 UTC `capturedAt` 冻结当前评分器、目录、问卷版本与基准时钟。
- 对评分源码与金标数据的每个文件记录 SHA-256，再生成分组快照哈希。
- 冻结 100 个 Anchor 与 25 个留出画像的固定对显示分、Top 10 及确定性 Top 3。
- 对 results 和除 `artifactSha256` 以外的规范 JSON 分别计算 SHA-256。
- 该 artifact 只能作为**今后**的回归分母，`historicalComparisonAllowed` 固定为 `false`。

## 操作方式

显式捕获（会重写前瞻 artifact）：

```bash
node scripts/capture-competition-prospective-baseline.mjs
```

如果最终发布已生成不可变源码归档，可同时绑定发布记录：

```bash
node scripts/capture-competition-prospective-baseline.mjs \
  --release-id '<release-id>' \
  --source-archive-sha256 '<64-character-lowercase-sha256>'
```

日常验证（只读，不会重生成）：

```bash
node scripts/verify-competition-prospective-baseline.mjs
```

默认 Vitest 也只验证已存在的真实 artifact。只有捕获脚本显式设置 `CAPTURE_COMPETITION_PROSPECTIVE_BASELINE=1` 时才会写入文件，避免回归失败时自动改写分母。

## 发布时序

前瞻 artifact 仅内容定址评分器与基准输入，不声称当前 Git commit 代表未提交工作树。最终发布前，应在所有评分相关文件停止变更后再执行一次捕获。

发布 bundle 必须遵守 artifact 中的 `releaseBindingContract`，以避免循环自引用：

1. 生成源码归档时排除 `tests/fixtures/competition-score-prospective-baseline.json`。
2. 对该源码归档计算 SHA-256，再用 `--release-id` 和 `--source-archive-sha256` 执行捕获。
3. 将最终 JSON 单独放入 bundle 的 `baseline/competition-score-prospective-baseline.json`，并将源码归档与该 sidecar 的字节级 SHA-256 都记入 `SHA256SUMS` 和 release manifest；manifest 同时记录 JSON 内的 `artifactSha256`。
4. 部署端先校验两个文件的 `SHA256SUMS`，再解包源码，将 sidecar 复制到 `tests/fixtures/competition-score-prospective-baseline.json`。
5. 只有上述复制完成后才能执行 `pnpm test` 或只读 verify；测试会同时校验内容闭包、125 个结果和 canonical artifact hash。

随后再更新外层 gold-freeze manifest，使其冻结本测试与新 artifact 的最终哈希。
