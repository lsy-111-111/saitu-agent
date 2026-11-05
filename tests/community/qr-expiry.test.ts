import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getGroupImage } from "@/app/community/[code]/route";
import TeamsPage from "@/app/(marketing)/teams/page";
import { groupCodeIsCurrent, groupExpiryLabel, teamGroups } from "@/content/community";

describe("team QR validity shown on the source cards", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the personal contact card and removes all expired group QR links", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-11T00:00:00+08:00"));
    const html = renderToStaticMarkup(React.createElement(TeamsPage));
    expect(html).toContain("/community/emily.png");
    expect(html).toContain("本批群二维码已过期");
    expect(html).not.toContain("/community/group-");
  });

  it("serves active QR pixels without caching and returns 410 at expiry", async () => {
    const now = vi.spyOn(Date, "now");
    const request = new Request("http://localhost/community/group-92.png");
    const context = { params: Promise.resolve({ code: "group-92.png" }) };
    now.mockReturnValue(Date.parse("2026-11-10T23:59:59+08:00"));
    const active = await getGroupImage(request, context);
    expect(active.status).toBe(200);
    expect(active.headers.get("cache-control")).toContain("no-store");
    expect(Array.from(new Uint8Array(await active.arrayBuffer()).slice(0, 4))).toEqual([137, 80, 78, 71]);
    now.mockReturnValue(Date.parse("2026-11-11T00:00:00+08:00"));
    const expired = await getGroupImage(request, context);
    expect(expired.status).toBe(410);
    expect((await expired.arrayBuffer()).byteLength).toBe(0);
    expect((await getGroupImage(request, { params: Promise.resolve({ code: "../emily.png" }) })).status).toBe(404);
  });

  it("stops offering the old code at midnight in Shanghai", () => {
    for (const group of teamGroups) {
      expect(groupCodeIsCurrent(group.expiresAt, Date.parse("2026-11-10T23:59:59.999+08:00"))).toBe(true);
      expect(groupCodeIsCurrent(group.expiresAt, Date.parse("2026-11-11T00:00:00+08:00"))).toBe(false);
      expect(groupExpiryLabel(group.expiresAt)).toBe("2026年11月11日");
    }
  });
});
