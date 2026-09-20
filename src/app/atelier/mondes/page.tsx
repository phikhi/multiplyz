import { notFound } from "next/navigation";
import { WorldScenesPreview } from "@/components/game/WorldScenesPreview";

/** A read-only art workbench. No DB, session, commands or progression. Absent in family production. */
export default function WorldScenesPage() {
  if (process.env.NODE_ENV !== "development" && process.env.TEDDY_CHECK_BUILD !== "worlds")
    notFound();
  return <WorldScenesPreview />;
}
