import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { TeamList } from "./team-list";

export const metadata: Metadata = { title: "Team · Rasi" };

/** S-14 staff list (US-014). A Senior sees their own line's team. */
export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <TeamList
      initial={readListParams(await searchParams, ["role", "status"])}
    />
  );
}
