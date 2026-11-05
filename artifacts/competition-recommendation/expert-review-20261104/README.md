# 赛途推荐评审材料（待独立复核）

64 道题来自随项目提供的测试种子，覆盖问答理解、赛事事实与算法评价。部分种子描述产品性质或符号化情境，不能直接计算真实学生画像的全库召回。

1. 两位评审分别获取 blind-cases.jsonl 和 review-template.csv 的空白副本。各自填写 reviewer_id、接受的多个结果、禁止结果、依据和 ISO 日期。decision 可填 usable、conditional、unjudgeable。评审前请保留答案独立，避开产品输出与裁决参考文件。
2. 两份表均完成后交予第三人。adjudicator-reference.jsonl 中的预期来自研究提案，第三人结合双方理由和对应届次官方正文处理重要分歧。
3. 从项目目录运行 `python3 scripts/check-competition-expert-review.py 评审甲.csv 评审乙.csv`。存在分歧时按脚本提示，用相同列提供仅包含分歧题目的第三人裁决表，并追加 `--adjudication 裁决.csv`。保留三份原始记录、证据快照和裁决结论，登记冻结版本后再评价算法。

目前仅工程回归可执行。评审人须自行确认依据；程序只检查表格完整性、不同评审标识和裁决覆盖。要报告 Recall 或 NDCG，另需事先标出每个真实可计算画像对全目录及实际展示赛道的相关度与重要候选。这里的 64 道种子含意图、政策和性质测试，不能代替这些标注。

## 逐例工程复跑

engineering-coverage.csv 将 64 个题号分别对应到当前实现的测试文件、用例标题和覆盖边界。21 项能重放所述工程性质，34 项仅覆盖部分断言，9 项必须独立核对材料或学生语言。后两类不计入整题通过率。通过这些用例不等于 64 题已经获得专家认可。

在项目根目录并启用 Node 环境后运行：

- `python3 scripts/check-competition-seed-coverage.py --run` 核对全部编号与测试位置，然后执行关联套件及独立指标测试。
- `python3 scripts/check-competition-seed-coverage.py --case ECASE01 --run` 只重放一题。纯人工题只输出待裁决原因。
- `node scripts/evaluate-competition-matching.mjs` 计算 25 个既有固定问卷画像的已标正例指标。加 `--original-series` 在新版评分下只比较原有系列。单独传入历史快照根目录则使用该快照的真实引擎。legacy-positive-comparison.json 记录对照，Hit@3 为前三至少命中一个已标系列，Recall@10 的分母为每个画像已标出的相关系列数；未标新增系列保持未知。
