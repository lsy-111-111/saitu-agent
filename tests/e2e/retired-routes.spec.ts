import { expect, test } from "@playwright/test";

const retiredPages = [
  "/discussions",
  "/discussions/retired-post",
  "/templates",
  "/start",
  "/check",
  "/builder",
  "/export"
] as const;

const retiredApis = [
  { method: "get", path: "/api/discussions" },
  { method: "post", path: "/api/discussions" },
  { method: "get", path: "/api/discussions/retired-post" },
  { method: "post", path: "/api/discussions/retired-post/replies" },
  { method: "post", path: "/api/discussions/retired-post/reports" },
  { method: "get", path: "/api/admin/moderation" },
  { method: "post", path: "/api/admin/moderation" },
  { method: "post", path: "/api/resume/parse" },
  { method: "post", path: "/api/export/pdf" },
  { method: "post", path: "/api/ai/diagnose" },
  { method: "post", path: "/api/ai/diagnose/stream" },
  { method: "post", path: "/api/ai/rewrite" },
  { method: "post", path: "/api/ai/match-job" }
] as const;

test("retired pages return 404 without redirects", async ({ request }) => {
  for (const path of retiredPages) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
});

test("retired APIs return 404", async ({ request }) => {
  for (const { method, path } of retiredApis) {
    const response = method === "get"
      ? await request.get(path, { maxRedirects: 0 })
      : await request.post(path, { data: {}, maxRedirects: 0 });
    expect(response.status(), `${method.toUpperCase()} ${path}`).toBe(404);
  }
});
