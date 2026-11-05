import { describe, expect, it } from "vitest";
import { GET } from "@/app/.well-known/security.txt/route";

describe("security.txt", () => {
  it("publishes a canonical, expiring security contact", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(body).toContain("Contact: mailto:privacy@siyuanjiaxin.com");
    expect(body).toContain("Expires: 2027-08-26T00:00:00.000Z");
    expect(body).toContain(
      "Canonical: https://siyuanjiaxin.com/.well-known/security.txt"
    );
    expect(body).toContain("Policy: https://siyuanjiaxin.com/privacy");
    expect(body).toContain("Preferred-Languages: zh-CN, en");
  });
});
