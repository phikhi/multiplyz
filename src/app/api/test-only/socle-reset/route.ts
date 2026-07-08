import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { socleWorlds } from "@/lib/db/schema";
import { socleAssetRefs, socleWorldId } from "@/lib/worldgen/socle";

// better-sqlite3 est un module natif : runtime Node obligatoire (pas d'edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/test-only/socle-reset — **route de test UNIQUEMENT** (404 en production, cf. garde
 * ci-dessous), remet un slot du socle à son état **placeholder par défaut** (`socleAssetRefs(slot)`,
 * même forme que juste après `runMigrations` — AUCUNE URL owner arbitraire acceptée).
 *
 * **Pourquoi une route HTTP et pas une connexion SQLite directe depuis le test E2E (story #199)** :
 * `getDb()` réutilise le **singleton long-lived** déjà ouvert par le serveur (`src/lib/db/index.ts`),
 * ce qui élimine la classe de risque « connexion SQLite fraîche ouverte hors du process serveur, par
 * chemin, après le boot » — une connexion `new Database(path)` ouverte depuis le worker de test est un
 * process SÉPARÉ du serveur, donc jamais garantie de voir le même état que ce que sert réellement l'app.
 * Investigation build story 6.11 (cf. corps de PR pour le détail complet) : un environnement local
 * `next dev`/Turbopack a montré une désynchronisation de `socle_worlds` (mécanisme NATIF hors Node,
 * confirmé par monkey-patch de `node:fs` — aucun appel applicatif `unlink`/`rm`) qui, dans ce cas précis,
 * a fini par affecter ce endpoint aussi — non entièrement résolu en local malgré ce changement d'archi.
 * Le passage par `getDb()` reste la conception correcte (seule connexion qui PEUT être fiable) ; si le
 * symptôme réapparaît en CI, c'est un signal à investiguer côté tooling `next dev`, pas côté ce fichier.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  let slot: unknown;
  try {
    ({ slot } = await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide" }, { status: 400 });
  }
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) {
    return NextResponse.json(
      { ok: false, error: "slot invalide : entier ≥ 0 attendu" },
      { status: 400 },
    );
  }
  const db = getDb();
  const result = db
    .update(socleWorlds)
    .set({ assetRefs: JSON.stringify(socleAssetRefs(slot)) })
    .where(eq(socleWorlds.id, socleWorldId(slot)))
    .run();
  return NextResponse.json({ ok: true, changes: result.changes });
}
