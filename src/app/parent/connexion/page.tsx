import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { householdExists } from "@/lib/auth/household";
import { listProfiles } from "@/lib/auth/login";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { ForestHome } from "@/components/ForestHome";
import { ProfileSelector } from "@/components/ProfileSelector";
export const dynamic = "force-dynamic";
export default async function ParentLoginPage() {
  const db = getDb();
  if (!householdExists(db)) redirect("/");
  if (await getCurrentParentSession()) redirect("/parent");
  return (
    <ForestHome>
      <ProfileSelector profiles={listProfiles(db)} startParent />
    </ForestHome>
  );
}
