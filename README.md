# 赛途竞赛助手

赛途是面向大学生竞赛新手的选赛助手，提供赛事目录、问答选赛、推荐详情、两项比较、收藏，以及组队和联系入口。

当前源码版本为 **v767-preview.1，第 4 次构建对应的开发快照**。本次更新保留既有 Git 提交历史，包含当前应用代码和运行必需的赛事证据。

## 下载 Mac 精简运行包

[打开 v767-preview.1-portable.1 下载页面](https://github.com/lsy-111-111/saitu-agent/releases/tag/v767-preview.1-portable.1)，选择 **赛途-v767-preview.1-Mac-精简运行包.zip**。

- ZIP 为 409.05 MiB，解压约 605.81 MiB，支持 Apple 芯片 Mac。
- 解压后双击「启动赛途.command」，访问 `http://127.0.0.1:3187`；使用后双击「停止赛途.command」。
- 已内置 Node.js 24.22.1、PostgreSQL 17.11 和运行依赖，无需安装开发工具。
- 这是为维护者现有 Mac 配置的本地试用包。AI 推荐需要联网，并读取该 Mac 上已有的私有配置。
- 配置与运行数据保存在 `~/Library/Application Support/赛途本地版/`。其中 `settings.json` 包含 AI 密钥，不在 GitHub 或 ZIP 内；数据库和个人使用记录也不随包上传。
- GitHub 自动生成的 `Source code (zip)` 是源码压缩包；双击运行请下载上面的中文命名 Mac ZIP。

版本来源、打包适配和原有验证记录见[本次发布说明](docs/releases/v767-preview.1/README.md)。

## 源码包含什么

应用代码、提示词、网页素材、服务端群二维码、数据库结构与迁移、依赖锁文件、测试、维护脚本及开发文档均保留。程序读取的 **364 个赛事证据文件，约 329.14 MiB** 也已纳入仓库，并保持原索引及相对路径。

历史实验快照、重复构建、开发依赖、缓存、日志、真实数据库和私有环境配置不随此次源码快照上传。`.gitignore` 仅放行上述必需证据，不会把整个历史材料目录一起纳入版本库。已有测试和维护文档仍可能引用本机保留的历史实验材料；本仓库快照不包含完整的历史实验运行环境。

`private/team-qr` 是应用服务端素材目录，但其中图片在本公开仓库中同样可见。网站按有效期收起群码不会删除 Git 中的图片记录。

## 本地开发

使用 Node.js `>=24.19.0 <25` 和 pnpm `11.19.0`，保留锁文件。

```bash
git clone https://github.com/lsy-111-111/saitu-agent.git
cd saitu-agent
pnpm install --frozen-lockfile
cp .env.example .env.local
```

在 `.env.local` 中配置自己的 PostgreSQL 连接、服务端 AI 密钥及独立的签名/哈希密钥，按数据库迁移和现有运行策略准备开发环境。配置文件仅保存在本机；AI 密钥不能使用 `NEXT_PUBLIC_` 前缀。

```bash
pnpm dev
```

该命令启动 `http://localhost:3000` 的网页开发服务。新版推荐任务还需要配套的 worker、数据库及运行授权；只启动网页进程不等于已准备完整的 AI 推荐环境。统一构建入口为 `pnpm build`，worker 运维见 [v7 worker 说明](ops/v7-worker-runbook.md)。

仓库中的「本地试用.command」及 [v767 本地试用合同](docs/v7/local-preview-contract-20261112.md) 面向维护者原机器的数据库和 Node 路径，使用端口 3177。希望直接运行现有版本时，请使用上面的 Mac 精简包，其独立端口为 3187。

## 页面入口

| 地址 | 用途 |
| --- | --- |
| `/` | 首页 |
| `/competitions` | 赛事目录与筛选 |
| `/competitions/[id]` | 单项赛事详情 |
| `/competitions/recommend` | 问答选赛与推荐 |
| `/competitions/saved` | 当前浏览器中的收藏 |
| `/teams` | 组队入口 |
| `/about#contact` | Emily 联系方式 |
| `/privacy`、`/terms` | 隐私政策与用户协议 |

## 发布与验证记录

2026 年 11 月 16 日的这次 GitHub 更新仅进行源码整理和附件发布，**未重新运行 lint、类型检查、测试、构建、浏览器验收或真实 AI 调用**。

Mac 包制作时已有 24 项浏览器检查和一次真实 AI 推荐的通过记录，详见[原始制作与验证记录](docs/releases/v767-preview.1/portable-verification-20261116.json)。这些是运行包制作时的历史结果，不表示此次上传重新执行了验收，也不代表生产上线验收完成。

生产部署仍按 [运维文档](ops/README.md) 单独执行；本次 GitHub 发布未部署网站。
