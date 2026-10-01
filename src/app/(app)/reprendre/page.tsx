import { redirect } from "next/navigation";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { getDb } from "@/lib/db";
import { getRegularityConfig } from "@/config/server-config";
import { dailyReturnPath } from "@/lib/game/daily-return";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function ReturnPage() {
  const id = await getCurrentChildProfileId();
  if (id === null) redirect("/");
  redirect(dailyReturnPath(getDb(), id, getRegularityConfig(), Date.now()));
}
