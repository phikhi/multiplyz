import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// better-sqlite3 est un module natif : runtime Node obligatoire (pas d'edge).
export const runtime = "nodejs";
// Round-trip DB à chaque appel → jamais de prerender statique.
export const dynamic = "force-dynamic";

/** GET /api/health → 200 `{ ok: true }` si le round-trip DB (`SELECT 1`) réussit. */
export function GET() {
  const db = getDb();
  const row = db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
  const healthy = row?.ok === 1;
  return NextResponse.json({ ok: healthy }, { status: healthy ? 200 : 503 });
}
