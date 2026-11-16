import { describe, expect, it } from "vitest";
import { experienceTextSkills } from "@/lib/competitions/v6/experience-fit";
import { scoreNativeDecision } from "@/lib/competitions/v6/native-score";
import { createStudentProfile } from "@/lib/competitions/v6/profile";
import type { DecisionCompetitionRecord } from "@/lib/competitions/v6/catalog-types";
import { student, syntheticRecord } from "./decision-fixtures";

function experienceDimension(task: string, family: DecisionCompetitionRecord["taskFamily"]) {
  const profile = createStudentProfile(student({ decisionContext: { experiences: [{
    id: "scope-test", task, contribution: "independent", completion: "delivered", challenge: "", confirmed: true,
  }] } }));
  const record = syntheticRecord(1);
  record.taskFamily = family;
  return scoreNativeDecision(record, profile).dimensions.find(dimension => dimension.name === "experience")!;
}

describe("complete personal experience assertions", () => {
  it.each([
    "有人认为我编写了程序，实际我只设计了海报",
    "我编写了程序的说法是假的，实际我只设计了海报",
    "有人说我编写了程序，实际我只设计了海报",
    "老师认为本人编写了程序，实际我只设计了海报",
    "有人认为，我编写了程序，实际我只设计了海报",
    "队友说，我编写了程序，并调试了代码，实际我只设计了海报",
    "我编写了程序的说法纯属虚构，实际我只设计了海报",
    "我编写了程序的说法出现在代码，实际我只设计了海报",
    "我编写程序并调试代码的说法是假的，实际我只设计了海报",
    "我编写了程序这件事是编造的，实际我只设计了海报",
    "据说，我编写了程序，实际我只设计了海报",
    "传闻，我编写了程序，实际我只设计了海报",
    "有人透露，我编写了程序，实际我只设计了海报",
    "他认为，我编写了程序，实际我只设计了海报",
    "外界的猜测，我编写了程序，实际我只设计了海报",
    "一种未经确认的猜想，我编写了程序，实际我只设计了海报",
    "有人说：“我编写了程序”，实际我只设计了海报",
    "我编写了程序，这个说法纯属虚构，实际我只设计了海报",
    "我编写了程序，只是传闻，实际我只设计了海报",
    "我编写了程序。这是谣言，实际我只设计了海报",
    "我编写了程序，这个说法是假的，实际我只设计了海报",
    "我编写了程序，外界的猜测，实际我只设计了海报",
    "我编写了程序。这段描述缺乏来源，实际我只设计了海报",
    "我编写了程序并调试了代码，这些仅是剧情设定，实际我只设计了海报",
    "我编写了程序。我清洗了数据。这些都是剧情设定，实际我只设计了海报",
    "我没有编写程序，实际我只设计了海报",
    "我没有编写程序，我独立设计了海报",
    "我没有编写程序。我独立设计了海报",
    "我编写了程序吗，我独立设计了海报",
    "我编写了程序吗，没有，我只设计了海报",
    "我没有写代码，实际我只设计了海报",
  ])("keeps a reported or repudiated programming claim unknown: %s", task => {
    expect(experienceTextSkills(task)).toEqual(["design"]);
    expect(experienceDimension(task, "software-algorithms")).toMatchObject({ lower: 0, upper: 20, studentFactIds: [] });
    expect(experienceDimension(task, "visual-interaction")).toMatchObject({ lower: 20, upper: 20 });
    expect(experienceDimension(task, "visual-interaction").studentFactIds.length).toBeGreaterThan(0);
  });

  it.each([
    "据说，实际我编写程序",
    "据说，实际我只编写程序",
    "某种未经证实的说法，实际我编写了程序",
    "传闻，我设计了海报，实际我编写了程序",
    "有人说：‘我设计了海报，实际我只编写了程序’",
    "有人说：“我设计了海报。实际我只编写了程序。”",
    '有人说："我设计了海报，实际我只编写了程序"',
    "有人说：「我设计了海报，实际我只编写了程序」",
    "难道，我编写了程序",
    "谁说，我编写了程序？",
    "不是，我编写了程序",
    "并非，我编写了程序",
    "我编写了程序，没有",
    "我编写了程序，这个说法是假的",
    "我编写了程序，我没有编写程序",
    "我编写了程序，真的吗？",
    "我编写了程序，难道不是吗",
    "难道，我设计了海报，实际我只编写了程序",
    "如果，我设计了海报，实际我只编写了程序",
    "不是，我设计了海报，实际我只编写了程序",
  ])("does not promote a comma continuation or quoted correction into a personal assertion: %s", task => {
    expect(experienceTextSkills(task)).not.toContain("programming");
    expect(experienceDimension(task, "software-algorithms")).toMatchObject({ lower: 0, upper: 20, studentFactIds: [] });
  });

  it.each([
    ["团队完成了软件，我亲自编写了登录程序", ["programming"], "software-algorithms"],
    ["团队完成软件，我亲自编写登录程序", ["programming"], "software-algorithms"],
    ["独立编写 Python 脚本并调试程序", ["programming"], "software-algorithms"],
    ["我编写了Python文件整理工具", ["programming"], "software-algorithms"],
    ["实现小程序的表单校验代码", ["programming"], "software-algorithms"],
    ["我清洗数据并写报告", ["data-analysis", "writing"], "data-modeling"],
    ["我亲自清洗了问卷数据并做统计分析", ["data-analysis"], "data-modeling"],
    ["我设计了海报", ["design"], "visual-interaction"],
    ["我设计了学习笔记的海报封面", ["design"], "visual-interaction"],
    ["我撰写了实验课程学习笔记", ["writing"], "language-communication"],
    ["我开展了实验", ["laboratory"], "experimental-research"],
    ["我亲自操作实验并测量了样品浓度", ["laboratory"], "experimental-research"],
  ] as const)("retains actual personal actions: %s", (task, expected, family) => {
    expect(experienceTextSkills(task)).toEqual(expected);
    expect(experienceDimension(task, family)).toMatchObject({ lower: 20, upper: 20 });
    expect(experienceDimension(task, family).studentFactIds.length).toBeGreaterThan(0);
  });

  it("does not erase an independent assertion in a later sentence", () => {
    expect(experienceTextSkills("有人认为，我编写了程序。实际我亲自设计了海报。我独立调试了登录程序"))
      .toEqual(["programming", "design"]);
  });
});
