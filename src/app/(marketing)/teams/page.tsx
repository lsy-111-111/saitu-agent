import type { Metadata } from "next";
import { TeamGroups } from "@/components/teams/TeamGroups";
import { seo } from "@/content/seo";
import { createMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createMetadata(seo.pages.teams);
export const dynamic = "force-dynamic";

export default function TeamsPage() {
  return <TeamGroups initialNow={Date.now()} />;
}
