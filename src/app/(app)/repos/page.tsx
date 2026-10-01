import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { getDb } from "@/lib/db";
import { getRegularityConfig } from "@/config/server-config";
import { dailyRestState } from "@/lib/game/daily-return";
import { ForestHome } from "@/components/ForestHome";
import { daily } from "@/strings/daily";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function RestPage() {
  const id = await getCurrentChildProfileId();
  if (id === null) redirect("/");
  // eslint-disable-next-line react-hooks/purity -- dynamic server route must evaluate today's parental limit for this request
  const { reason, active } = dailyRestState(getDb(), id, getRegularityConfig(), Date.now());
  return (
    <ForestHome quiet>
      <main className="daily-main daily-rest">
        <section className="daily-card" data-rest-reason={reason}>
          <p className="forest-kicker">{daily.readyForTomorrow}</p>
          <h1>
            {reason === "limit"
              ? daily.limitTitle
              : reason === "suggested"
                ? daily.suggestedTitle
                : daily.restTitle}
          </h1>
          <p>
            {reason === "limit"
              ? daily.limitHint
              : reason === "suggested"
                ? daily.suggestedHint
                : daily.restHint}
          </p>
          <p>{daily.restSaved}</p>
          <Link href="/" className="forest-primary">
            {daily.home}
          </Link>
          {reason !== "limit" && (
            <Link href={active ? "/jouer" : "/carte"} className="forest-secondary">
              {active ? daily.resume : daily.continue}
            </Link>
          )}
          <Link href="/collection" className="daily-link">
            {daily.collection}
          </Link>
        </section>
      </main>
    </ForestHome>
  );
}
