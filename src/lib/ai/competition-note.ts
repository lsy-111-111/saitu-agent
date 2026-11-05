export const COMPETITION_NOTE_PRIVACY_MESSAGE =
  "请删除姓名、学校、手机号、邮箱或其他个人信息后再继续。";

const commonChineseSurname =
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄家封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶黎乔苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧利蔚越隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";

const commonChineseCompoundSurname =
  "欧阳|司马|上官|诸葛|夏侯|皇甫|尉迟|公孙|慕容|司徒|司空";
// Bare short Chinese phrases are too ambiguous to classify by length alone.
// Use a deliberately privacy-biased given-name character set, including
// regression characters that previously bypassed the filter (一、鸣、晗、羽).
const commonChineseGivenNameCharacter =
  "伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂英华慧红玉兰鑫梅雪晨宇浩轩涵萱怡欣雨子梓思嘉佳俊鹏飞建志文玲婷丹斌健宁倩峰博睿泽瑞豪毅凯亮晶洁琳颖莉晓燕春秋冬阳昊然航哲诚安乐悦妍媛琪瑶聪彤彦璐依伊琦皓弘晞铭恩卓晖桐森宏庆宝继德惠贵贤瑛瑜君奇娇艺琴蓉彩菊凤莲辉胜龙翔珍珠立良忠义维新小云亦菲伦富城近露梦诗紫若熙馨语嫣诺源花昭一鸣晗羽";
const hanCharacterSource = "\\p{Script=Han}";
const commonChineseNameSource =
  `(?:(?:${commonChineseCompoundSurname})|[${commonChineseSurname}])` +
  `(?:·?[${commonChineseGivenNameCharacter}]){1,3}`;
const chineseNameBoundarySource =
  "[，。！？；：、,.;:!?\\s\"'“”‘’（）()\\[\\]【】《》<>]";
const chineseNameActionSource =
  "(?:想|希望|目前|现在|擅长|参加|准备|负责|就读|学习|是|有|会|可以|正在|打算|计划)";

const explicitChineseNamePattern = new RegExp(
  `(?:我叫|本人叫|叫我)\\s*${hanCharacterSource}{2,4}(?=$|${chineseNameBoundarySource}|${chineseNameActionSource})|` +
  `(?:姓名|名字)\\s*(?:是|为|叫|[:：=])\\s*${hanCharacterSource}{2,4}(?=$|${chineseNameBoundarySource}|${chineseNameActionSource})`,
  "u"
);

const standaloneChineseNamePattern = new RegExp(
  `(?:^|${chineseNameBoundarySource})${commonChineseNameSource}(?=$|${chineseNameBoundarySource})`,
  "u"
);
const leadingChineseNameWithActionPattern = new RegExp(
  `(?:^|${chineseNameBoundarySource})${commonChineseNameSource}(?=${chineseNameActionSource})`,
  "u"
);
const relatedPersonNamePattern = new RegExp(
  `(?:队友|同学|导师|老师|联系人|负责人|指导教师|指导老师)(?:叫|是|为|[\\s：:]){0,3}${commonChineseNameSource}` +
  `(?=$|${chineseNameBoundarySource}|${chineseNameActionSource})`,
  "u"
);

const knownSchoolAbbreviationPattern =
  /(?:北大|清华|复旦|上交|浙大|南大|武大|华科|西交|哈工大|北航|北邮|北师大|华师大|中科大|电子科大|北理|同济)(?:[\u4e00-\u9fffA-Za-z0-9]{0,16}(?:系|学院|专业))?/i;

const prohibitedCompetitionNotePatterns = [
  /(?:\+?86[-\s]?)?1[3-9](?:[-\s]?\d){9}/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/i,
  /(?:\d[ -]?){16,19}/,
  /[\u4e00-\u9fffA-Za-z\s·]{2,40}(?:大学|学院)/i,
  /(?:来自|就读于?|毕业于|保研至|保研到)\s*(?:某校|本校|我校)/i,
  /(?:(?:微信|微\s*信|wechat)(?:号|账号|\s*id)|(?:v信|vx|wx)(?:号|账号|\s*id)?)\s*[:：=]?\s*[A-Za-z0-9][A-Za-z0-9_-]{2,24}/i,
  /(?:微信|微\s*信|wechat|v信|vx|wx)\s*(?:[:：=]|\s+)\s*[A-Za-z0-9][A-Za-z0-9_-]{2,24}/i,
  /(?:微信|微\s*信|wechat|v信|vx|wx)\s*[:：=]\s*[^　\s，。！？；]{2,25}/i,
  /(?:qq|q\s*q|扣扣|企鹅号|q号)\s*(?:号|账号|id)?\s*(?:是|为|[:：=])?\s*[1-9](?:[-\s]?\d){4,11}/i,
  /(?:学号|学生编号|学生证号|校园卡号|一卡通号|student\s*(?:id|number))\s*(?:是|为|[:：=])?\s*[A-Za-z0-9](?:[A-Za-z0-9_ -]{2,22}[A-Za-z0-9])/i,
  /(?:座机|联系电话|联系方式|电话)\s*[:：]?\s*(?:\+?86[-\s]?)?(?:\(?0\d{2,3}\)?[-\s]?)?\d{7,8}(?:-\d{1,6})?/i,
  /(?:^|\D)\(?0\d{2,3}\)?[-\s]?\d{7,8}(?:-\d{1,6})?(?=$|\D)/,
  /(?:家住|家在|住在|居住于|现居|家庭住址|现住址|通讯地址|收货地址|宿舍(?:在|地址)?|寝室(?:在|地址)?|地址\s*[:：])\s*[^，。！？；\n]{4,60}/i,
  /[\u4e00-\u9fff]{2,24}(?:路|街|大道|胡同|巷|弄)\s*\d{1,5}\s*号(?:\s*(?:楼|栋|单元|室))?/i,
  explicitChineseNamePattern,
  new RegExp(
    `(?:我是|本人是)\\s*${commonChineseNameSource}(?=$|${chineseNameBoundarySource}|${chineseNameActionSource})`,
    "u"
  ),
  /(?:^|[，。！？；：,:\s])(?:张三|李四|王五|赵六|陈晨|王小明)(?=$|[，。！？；：,:\s])/i
] as const;

const scopedCompetitionStudentPhrase =
  /((?:全国|中国(?:国际)?|国际|高校))大学生(?=(?:(?!大学生)[^，。！？；\n]){0,40}(?:竞赛|大赛|比赛))/g;
const standaloneCompetitionStudentPhrase =
  /(^|[，。！？；：,:\s])大学生(?=(?:(?!大学生)[^，。！？；\n]){0,40}(?:竞赛|大赛|比赛))/g;
const genericStudentSelfDescription =
  /(^|[，。！？；：,:\s])((?:我|我们)(?:目前|现在)?(?:是|都是|仍是|还是)(?:一名|在校)?)大学生(?=$|[，。！？；：,:\s])/g;
const genericStudentRoleDescription =
  /(^|[，。！？；：,:\s])(作为(?:一名|在校)?)大学生(?=$|[，。！？；：,:\s])/g;

function normalizedCompetitionPrivacyText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(scopedCompetitionStudentPhrase, "$1学生")
    .replace(standaloneCompetitionStudentPhrase, "$1学生")
    .replace(genericStudentSelfDescription, "$1$2学生")
    .replace(genericStudentRoleDescription, "$1$2学生");
}

function containsSharedCompetitionPersonalInfo(normalized: string) {
  if (prohibitedCompetitionNotePatterns.some((pattern) => pattern.test(normalized))) return true;

  // School abbreviations are commonly separated to evade filters (for
  // example “北 理”). Compacting whitespace only for this closed alias list
  // avoids changing the semantics of the other patterns.
  return knownSchoolAbbreviationPattern.test(normalized.replace(/\s+/g, ""));
}

/**
 * Server-authored prompts and option labels cannot contain user-supplied bare
 * names. Keep the explicit PII rules on that boundary without treating short
 * competition vocabulary as a person's name.
 */
export function containsCompetitionGeneratedTextPersonalInfo(value: string) {
  return containsSharedCompetitionPersonalInfo(normalizedCompetitionPrivacyText(value));
}

/** User-entered questionnaire and clarification text uses the stricter rule. */
export function containsCompetitionNotePersonalInfo(value: string) {
  const normalized = normalizedCompetitionPrivacyText(value);
  if (containsSharedCompetitionPersonalInfo(normalized)) return true;

  if (
    standaloneChineseNamePattern.test(normalized) ||
    leadingChineseNameWithActionPattern.test(normalized) ||
    relatedPersonNamePattern.test(normalized)
  ) {
    return true;
  }
  return false;
}
