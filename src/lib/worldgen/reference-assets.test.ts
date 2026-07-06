import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  approveAsset,
  expressionAssetId,
  getApprovedMaster,
  listReferenceAssets,
  MASTER_ASSET_ID,
  ReferenceApprovalError,
  upsertCandidate,
  type ReferenceAssetInput,
} from "./reference-assets";

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-refassets-"));
let counter = 0;
function freshDb() {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function masterInput(overrides: Partial<ReferenceAssetInput> = {}): ReferenceAssetInput {
  return {
    id: MASTER_ASSET_ID,
    kind: "master",
    expression: null,
    assetRef: "storage/reference/teddy/teddy-master.png",
    backgroundStrategy: "post-cutout",
    transparent: true,
    sourcePhotosHash: "hash-1",
    ...overrides,
  };
}

describe("clés stables des assets de référence", () => {
  it("MASTER_ASSET_ID = teddy:master ; expressionAssetId préfixe par slug", () => {
    expect(MASTER_ASSET_ID).toBe("teddy:master");
    expect(expressionAssetId("oups")).toBe("teddy:expression:oups");
  });
});

describe("upsertCandidate (persiste un candidat, idempotent)", () => {
  it("insère un candidat (status=candidate, transparent mappé en 0/1, approved_by null)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    const [row] = listReferenceAssets(db);
    expect(row).toMatchObject({
      id: MASTER_ASSET_ID,
      kind: "master",
      expression: null,
      assetRef: "storage/reference/teddy/teddy-master.png",
      backgroundStrategy: "post-cutout",
      transparent: true,
      status: "candidate",
      approvedBy: null,
    });
  });

  it("mappe transparent=false → carte pleine (bool ← entier 0)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput({ transparent: false, backgroundStrategy: "full-card" }));
    const [row] = listReferenceAssets(db);
    expect(row.transparent).toBe(false);
    expect(row.backgroundStrategy).toBe("full-card");
  });

  it("rejouer Stage A remplace le candidat au même id (pas de doublon)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput({ assetRef: "old.png" }));
    upsertCandidate(db, masterInput({ assetRef: "new.png", sourcePhotosHash: "hash-2" }));
    const rows = listReferenceAssets(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].assetRef).toBe("new.png");
  });

  // GARDE À EFFET OBSERVABLE (WORLDGEN §8 : re-valider à la main) : un candidat régénéré NE
  // conserve JAMAIS une approbation précédente — l'upsert remet status=candidate + approved_by
  // à NULL. Mutation : retirer `status`/`approvedBy` du `set` de l'upsert → ce test rougit.
  it("un master régénéré perd son approbation précédente (redevient candidate, approved_by null)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    approveAsset(db, MASTER_ASSET_ID, "owner");
    expect(getApprovedMaster(db)).not.toBeNull();

    // Régénération (rejeu Stage A) → doit invalider l'approbation.
    upsertCandidate(db, masterInput({ assetRef: "regen.png", sourcePhotosHash: "hash-3" }));
    const [row] = listReferenceAssets(db);
    expect(row.status).toBe("candidate");
    expect(row.approvedBy).toBeNull();
    expect(getApprovedMaster(db)).toBeNull();
  });

  it("stocke le master + les 5 expressions (model sheet complet)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    for (const slug of ["neutre", "content", "oups", "acclame", "intrepide"]) {
      upsertCandidate(
        db,
        masterInput({
          id: expressionAssetId(slug),
          kind: "expression",
          expression: slug,
          assetRef: `teddy-${slug}.png`,
        }),
      );
    }
    expect(listReferenceAssets(db)).toHaveLength(6);
  });
});

describe("approveAsset (sign-off owner manuel du Teddy canonique)", () => {
  it("fige un candidat en approved avec l'identité de l'approbateur", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    const approved = approveAsset(db, MASTER_ASSET_ID, "owner");
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe("owner");
  });

  it("trim l'approbateur (espaces autour ignorés)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    expect(approveAsset(db, MASTER_ASSET_ID, "  owner  ").approvedBy).toBe("owner");
  });

  // GARDE À EFFET OBSERVABLE : un master ne peut pas être figé sans approbateur (freeze
  // explicite). Mutation : retirer la garde `if (!who)` → un `approvedBy` vide passerait → rouge.
  it("refuse une approbation sans approbateur (vide / espaces) → ReferenceApprovalError", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    expect(() => approveAsset(db, MASTER_ASSET_ID, "   ")).toThrow(ReferenceApprovalError);
    // L'asset reste candidate (aucune écriture).
    expect(listReferenceAssets(db)[0].status).toBe("candidate");
  });

  // GARDE À EFFET OBSERVABLE : approuver un id inconnu lève (pas de création silencieuse).
  // Mutation : retirer la garde `if (!updated)` → renverrait un asset undefined → rouge.
  it("refuse d'approuver un id inconnu → ReferenceApprovalError", () => {
    const db = freshDb();
    expect(() => approveAsset(db, "teddy:inexistant", "owner")).toThrow(ReferenceApprovalError);
  });
});

describe("getApprovedMaster (ancre du Stage B — jamais un candidat)", () => {
  it("retourne null quand le master reste candidat (non figé)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    expect(getApprovedMaster(db)).toBeNull();
  });

  it("retourne null quand aucun master n'existe", () => {
    const db = freshDb();
    expect(getApprovedMaster(db)).toBeNull();
  });

  it("retourne le master une fois approuvé (sign-off owner)", () => {
    const db = freshDb();
    upsertCandidate(db, masterInput());
    approveAsset(db, MASTER_ASSET_ID, "owner");
    const master = getApprovedMaster(db);
    expect(master?.id).toBe(MASTER_ASSET_ID);
    expect(master?.status).toBe("approved");
  });

  // GARDE À EFFET OBSERVABLE : `getApprovedMaster` filtre sur id=master ET status=approved.
  // Une expression approuvée ne doit PAS être renvoyée comme master. Mutation : retirer le
  // filtre `id = MASTER_ASSET_ID` → une expression approuvée pourrait remonter → rouge.
  it("n'ancre pas sur une expression approuvée (filtre id=master)", () => {
    const db = freshDb();
    upsertCandidate(
      db,
      masterInput({ id: expressionAssetId("content"), kind: "expression", expression: "content" }),
    );
    approveAsset(db, expressionAssetId("content"), "owner");
    // Une expression approuvée existe, mais aucun MASTER approuvé.
    expect(getApprovedMaster(db)).toBeNull();
  });
});
