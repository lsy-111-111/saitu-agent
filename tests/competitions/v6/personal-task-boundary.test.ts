import { describe, expect, it } from "vitest";
import { experienceTextSkills } from "@/lib/competitions/v6/experience-fit";

describe("personal task evidence boundary", () => {
  it.each([
    "团队做了小程序，我只负责设计海报，没有写代码",
    "我们开发了软件，我只是旁观，没有编程",
    "我计划用 Python 编写程序，尚未开始",
    "团队开发软件我负责排版，没有参与开发",
    "我做了介绍团队开发软件成果的海报",
    "我看过队友调试程序",
    "我未编写程序，只负责海报设计",
    "我不做编程，只负责海报设计",
    "我整理了他们编写的程序介绍",
    "我只是看大家编程",
    "我学习了编程课程",
  ])("does not credit team, denied, observed or future programming: %s", task => {
    expect(experienceTextSkills(task)).not.toContain("programming");
  });
  it("does not transfer an unmarked team continuation into the student's evidence", () => {
    expect(experienceTextSkills("队友负责建模，数据清洗和统计分析；我负责海报设计")).toEqual(["design"]);
  });
  it.each([
    ["我整理数据分析课程的学习笔记，只听讲解，没做数据清洗", "data-analysis"],
    ["我记录实验演示视频的笔记，只观看没有操作", "laboratory"],
    ["我编写了程序吗？没有，只负责海报设计", "programming"],
    ["我编写了程序吗，没有，我只设计了海报", "programming"],
    ["难道我编写过程序，没有，我只负责海报设计", "programming"],
    ["队友以为我编写了程序，我只是设计了海报", "programming"],
    ["我是否开发过登录功能？并没有", "programming"],
    ["假设我独立清洗数据，可以学到什么？", "data-analysis"],
  ])("keeps questions and learning-material subjects unknown: %s", (task, skill) => {
    expect(experienceTextSkills(task)).not.toContain(skill);
  });
  it("keeps the actual personal design contribution and separately affirmative programming", () => {
    expect(experienceTextSkills("团队做了小程序，我只负责设计海报，没有写代码")).toEqual(["design"]);
    expect(experienceTextSkills("团队做了小程序，我独立开发登录功能，队友设计海报")).toEqual(["programming"]);
    expect(experienceTextSkills("独立编写 Python 脚本并调试程序")).toContain("programming");
  });
});
