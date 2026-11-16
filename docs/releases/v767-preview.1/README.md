# v767-preview.1 源码与 Mac 运行包

- 源码基线：`v767-preview.1` 第 4 次构建对应的当前开发快照，包含此前尚未提交的应用修改和新增文件。
- GitHub Release 标签：`v767-preview.1-portable.1`，标记为预览版。
- 原仓库历史继续保留；本次快照排除旧实验报告和构建副本，仅保留程序必需的赛事证据。
- 本次没有主动合入另一对话计划中的页面改版。

## 源码与运行包的关系

本次固定源码时，运行包制作记录中的 1,605 个原始输入文件与开发源码一致。源码上传时排除其中的 1 个 Python 编译缓存，另保留项目根配置、数据库工具和开发说明。输入文件摘要保存在 [source-input-sha256.json](source-input-sha256.json)。这份摘要描述原始开发输入；本次发布另更新了仓库 README、忽略规则和发布记录。

Mac 包在独立打包目录对同一应用基线作了运行适配：端口从 3177 改为 3187，内置独立运行环境与数据库启动逻辑，并使用 standalone 网页输出。因此包内运行源码摘要与未经打包适配的开发源码摘要不同，不应直接互换。现有适配差异见 [portable-source-adaptations.patch](portable-source-adaptations.patch)。原包不重新构建或改写。

## 下载附件

[GitHub 下载页](https://github.com/lsy-111-111/saitu-agent/releases/tag/v767-preview.1-portable.1)

| 项目 | 值 |
| --- | --- |
| 文件名 | 赛途-v767-preview.1-Mac-精简运行包.zip |
| 大小 | 428,922,238 字节（409.05 MiB） |
| 解压大小 | 约 605.81 MiB |
| 平台 | macOS / Apple Silicon arm64 |
| Node.js | 24.22.1 |
| PostgreSQL | 17.11 |
| 网页端口 | 127.0.0.1:3187 |
| 数据库端口 | 127.0.0.1:55432 |
| 候选池 | 45 项 |

原交付记录中的 ZIP SHA-256：

```text
659e7868ff8a111307d38a27990d47c3aa18036487aea977938b4a0e793a7f9c
```

完整运行说明在 ZIP 内。首次启动创建独立空数据库；密钥使用维护者这台 Mac 上已有的私有配置，数据位置为 `~/Library/Application Support/赛途本地版/`。该目录及其中的 `settings.json` 未上传。

## 验证边界

本次按维护者要求直接上传，不重跑测试、构建、启动或 AI 验证。以下文件均为 2026 年 11 月 16 日制作精简包时已有的记录：

- [制作与验证结果](portable-verification-20261116.json)：24 项浏览器检查及一次真实 AI 推荐等制作阶段结果。
- [原交付校验记录](portable-archive.json)：包大小、摘要和当时的 ZIP 完整性记录。

这些历史结果不作为本次重新验收、完整历史实验复现或生产部署批准。
