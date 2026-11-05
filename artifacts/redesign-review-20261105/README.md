# 赛途本地改版验收

查看本机 [首页](http://127.0.0.1:3000/)、[问答首题](http://127.0.0.1:3000/competitions/recommend)、[化学实验创新设计详情](http://127.0.0.1:3000/competitions/chemistry-experiment-innovation)、[竞赛组队](http://127.0.0.1:3000/teams)和[关于我们](http://127.0.0.1:3000/about)。本记录只针对本地运行项目，没有部署到生产环境。

| 验收项目 | 观察结果 |
|---|---|
| 首次选赛 | 桌面和手机宽度下，从首页进入可立即选择的目标题。支持快速/深入、留空不确定项、修改既有回答、必要时追问和重算。4–6 分钟是设计目标，未经过真实学生计时。 |
| 推荐与收藏 | 重点结果允许 0–3 项；可比较、查漏推、查看当月资料。展开资料不会重排或重新请求推荐。历史三项收藏可打开，新收藏保留当时赛道。官方依据在相应字段旁可点击。 |
| 目录与来源 | 135 个独立详情网址逐个实测 HTTP 200，未知编号返回 404，原资源网址 308 跳转竞赛信息。逐系列资料、来源和需要核实的事项见[目录核查](../catalog-research-20261104/README.md)。 |
| 证书及联系 | 27 张工作照片中：8 张群码，17 份不同的获奖证明、1 份聘书，另有 1 份完全重复的奖状。关于页使用独立的 Emily 学姐个人微信码。16 份作品与团队奖、1 份指导教师荣誉、1 份聘书分开展示。缩略图和放大图都来自压平后的脱敏图片；奖项相关他人姓名、签名、验真码及证书编号遮盖，无未脱敏公开副本。[公开资产清单与校验和](certificate-manifest.json) |
| 二维码有效期 | 桌面与手机视口对 8 张群码和个人码进行了识别实测。北京时间 11 月 11 日 00:00 起，页面显示 Emily 联系方式；跨午夜、恢复可见和后退恢复均更新。过期群码直链返回 410。 |
| 模型及同意 | 未把真实学生资料发给模型测试。签名 API 与模拟上游验证了 v7 同意：模型只在固定结果中选择解释依据；名次、赛道与事实不能由模型改写。旧同意不能作新用途授权。无可用模型时退回规则解释。 |
| 日期与资格 | 针对开放、截止、未知与请求近期报名做不变性检查；只变日期不改变适配顺序。30 个显式且有依据的硬冲突被排除；资源可争取与确实拿不到分别处理。化学的实验、数据、传播及拒绝实验的画像独立测试。 |
| 效果验证 | 64 道原始种子已保留：21 道可重放完整工程性质，34 道仅部分可自动核对，9 道待人工判断。[逐题映射、评审表与独立复核说明](../competition-recommendation/expert-review-20261104/README.md)。 |

## 复跑

在项目根目录，使用 Node 24 与项目依赖：

```sh
pnpm typecheck
pnpm build
python3 scripts/verify-competition-catalog-research.py
python3 scripts/check-competition-seed-coverage.py --run
pnpm exec vitest run tests/community/qr-expiry.test.ts tests/ai/competition-decision-explanation.test.ts tests/ai/competition-recommend-route.test.ts
pnpm exec playwright test competition-platform.spec.ts competition-recommend.spec.ts saved-competitions.spec.ts
```

浏览器问答全矩阵曾记录 35 项通过、9 项按用例设计跳过；使用本机 Chrome 的该轮有 3 个 worker 在收尾时超时，不将它计作整次测试进程正常退出。最终使用本机 Chrome 重跑桌面和手机六项关键路径（快速问答、比较/查漏、修改重算、保存结果、旧资源跳转），6/6 通过，进程正常退出。资料来源、近期报名和分享链接另在双视口分批验证。生产模型输出质量与真实学生的选赛收益未实测。

新版改变了旧的候选数量、日期优先和打分契约，仍有历史固定输入的排序和追问结果未达旧门槛。另有 8 项发布校验要求按旧清单校验经审核的文件哈希；未擅自重签或部署。[旧验收差异逐项说明](../competition-recommendation/expert-review-20261104/legacy-checks.md)。

生产构建、TypeScript 和 ESLint 通过。全仓 Vitest（每例 20 秒上限）最后一次运行：889 项通过、27 项失败、23 项跳过。19 项是旧的评分、追问、质量门槛及冻结基线检查，8 项是发布审查清单。默认 5 秒上限并发构建时有一个循环额外超时；独立复跑和 20 秒上限均通过。保留旧评审与发布断言，没有把失败项删掉换成通过。[逐项失败名称与工程摘要](engineering-results.json)
