# 浏览器性能协议与执行入口

`scripts/competitions/v6/run-product-performance.mjs` 使用真实生产构建、Next HTTP服务及Playwright页面完成注册流程。计时从确认提交按钮点击前开始，包含归一化、自动化补充问答、推荐请求和浏览器渲染；不使用模型耗时替代。首屏要求实际竞赛方向正文进入视口；完整报告要求HTTP返回、报告主体和完整建议入口已渲染并经过两次动画帧。测试时间不是真人作答时间。

注册文件包含不可重复的journeyId、profileId、profileInput、quick/deep、desktop/mobile和实际UI步骤。正式注册至少100次、60份不同输入、桌面与移动各50次、两类流程，并绑定画像独立性审查原件哈希。正式profileInput使用`saitu.performance-profile.v1`严格合同：facts仅包含field/value/state/confirmed/evidenceLevel，另含unknownFields、goals、primaryGoal、tradeoffStatus、mode；不能靠unusedLabel、ID或时间戳制造不同画像。运行后从实际HTTP报告重新提取同一语义投影，与注册逐项比对，mode也必须对应实际快／深流程。汇总再次从保存的原始响应核对，未匹配者不能计入实际画像或成功性能。

独立性审查文件使用`saitu.performance-profile-review.v1`，绑定不同的authorContextId与两个reviewerContextIds，以及全部profileId、semanticSha256、互不相同的familyId和批准结果。文件哈希相同但内容未支持登记画像时仍拒绝。独立性不能仅靠改ID证明；语义审查仍是独立验收项。补充问题须预先注册其原文匹配与选项，未见问题保留失败，不能临场选最有利答案。

```sh
node scripts/competitions/v6/run-product-performance.mjs \
  --registration REGISTRATION.json --registration-sha256 SHA256 \
  --output NEW_OUTPUT_DIRECTORY
```

默认只验证注册、不构建也不调用模型。`--live`会验证真实PostgreSQL和同一费用账本，强制禁止mock配置并要求max，随后构建、启动`127.0.0.1:3131`、执行全部注册流程并关闭服务。使用`AI_SPEND_PHASE=performance`，保留原run及累计账本；前置条件仍是内容覆盖、正式冻结、独立画像和完整费用计划已准备。不要在这些条件未满足时运行大规模付费矩阵。

`--mock-smoke`仅允许development注册，用于执行器和UI工程调试，不能计入正式性能或模型质量。Browser插件不可用，因此采用仓库Playwright；可通过`--chrome`传入已安装浏览器路径。

每次使用新目录保存注册、源码摘要、生产BUILD_ID、非敏感运行配置、实际PG只读结果、逐次HTTP报告、浏览器异常、首屏与整页截图及汇总。浏览器签名令牌不落盘。无预热推荐、无重试；失败/未执行按无限延迟进入原定分母，p95落在无限值时记录null并说明原因。回退完整保留。源码中途变化即停止，并保留其余未执行行。任何单次或汇总结果均不自行写验收通过。

首屏标记必须匹配实际响应的方向与具体下一步正文并进入视口，或具体竞赛名称与对应理由同时可见；通用标题与任意长段落不算。完整报告检查默认展示的最多5项的名称、任务、角色、理由和下一步均已绑定响应且渲染，超过5项须有展开其余项入口；有效0候选报告以明确不足原因和完整总结处理。展开内容无需假装已经进入第一屏。实际响应只用于观察，不注入页面DOM或替代网络返回。

本轮工程实跑：`artifacts/continuation-20261105/performance-smoke-01/`保留进入报告时停留中段导致的2次首屏未达记录；修正结果页滚动后，`performance-smoke-02/`桌面与移动均观察到真实HTTP规则报告、方向正文与下一步，无页面/控制台错误或横向溢出。两次为同一公开模拟新手、mock归一化、零付费，既不是100次正式性能，也不是两个独立学生。
