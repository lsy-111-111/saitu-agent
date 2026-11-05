/**
 * Privacy-only regression matrix. It is intentionally separate from the
 * balanced 300-sample interpretation fixture so safety coverage cannot change
 * macro-F1 weighting or the transport-questionnaire gold data.
 */
export const competitionPiiRegressionTexts = [
  "王一鸣",
  "欧阳一鸣",
  "我叫鹿晗羽",
  "名字：鹿晗羽",
  "王小华",
  "张伟",
  "马云",
  "刘亦菲",
  "王小华想参加编程竞赛",
  "队友王小华擅长建模",
  "王\u200B小华",
  "北 理读大三",
  "同济读研",
  "来自某校",
  "微信 12345678",
  "wx：12345678",
  "微信号：abc_2026",
  "微信：小华",
  "企鹅号 12345678",
  "扣扣号：87654321",
  "学生证号：AB20261234",
  "校园卡号 20260001",
  "北京市海淀区中关村大街27号",
  "中关村大街27号",
  "010-12345678",
  "(010)12345678",
  "办公电话：021 12345678"
] as const;

export const competitionPiiSafeControlTexts = [
  "周末可以集中投入",
  "高职生",
  "高水平建模训练",
  "全国大学生数学建模竞赛",
  "有团队合作经验",
  "商业计划书",
  "王者荣耀赛事策划",
  "北斗导航项目",
  "微信小程序开发",
  "QQ机器人开发",
  "学号字段不需要填写",
  "地址匹配问题不重要",
  "座机设备控制",
  "学校可以提供报名支持",
  "来自农村的农业项目",
  "北京赛区可以出行",
  "010算法题",
  "任一参赛方式都可以",
  "每周投入10小时"
] as const;
