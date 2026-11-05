export const emilyQr = "/community/emily.png";

// The source cards specify “11月11日前”. Use midnight in Shanghai as the cutoff.
const novemberExpiry = "2026-11-11T00:00:00+08:00";

export const teamGroups = [
  { name: "大学生竞赛资源共享群", src: "/community/group-92.png", expiresAt: novemberExpiry },
  { name: "25商赛资源共享组队群", src: "/community/group-93.png", expiresAt: novemberExpiry },
  { name: "数模竞赛一群", src: "/community/group-94.png", expiresAt: novemberExpiry },
  { name: "大挑竞赛一群", src: "/community/group-95.png", expiresAt: novemberExpiry },
  { name: "全国大学生电子设计竞赛一群", src: "/community/group-96.png", expiresAt: novemberExpiry },
  { name: "市调大赛竞赛一群", src: "/community/group-97.png", expiresAt: novemberExpiry },
  { name: "ICPC竞赛一群", src: "/community/group-98.png", expiresAt: novemberExpiry },
  { name: "国创赛竞赛一群", src: "/community/group-99.png", expiresAt: novemberExpiry }
];

export function groupCodeIsCurrent(expiresAt: string, now: number) {
  return now < Date.parse(expiresAt);
}

export function groupExpiryLabel(expiresAt: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(expiresAt));
}
