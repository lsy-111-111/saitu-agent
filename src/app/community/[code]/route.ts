import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { groupCodeIsCurrent, teamGroups } from "@/content/community";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const group = teamGroups.find(entry => entry.src === `/community/${code}`);
  const headers = { "Cache-Control": "private, no-store" };
  if (!group) return new Response(null, { status: 404, headers });
  if (!groupCodeIsCurrent(group.expiresAt, Date.now())) return new Response(null, { status: 410, headers });

  const image = await readFile(join(process.cwd(), "private", "team-qr", code));
  return new Response(new Uint8Array(image), { headers: { ...headers, "Content-Type": "image/png" } });
}
