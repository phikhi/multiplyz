import "server-only";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import {
  teddyReferenceAssets,
  type ReferenceAssetStatus,
  type TeddyAssetKind,
} from "@/lib/db/schema";

/**
 * Persistance des **assets de référence Teddy** (master + model sheet, WORLDGEN §8, story 6.2).
 * SERVER-ONLY (comme le client image) : ces helpers tournent dans le worker daemon / un script
 * one-shot, jamais côté client.
 *
 * Cycle de vie : l'outil Stage A **upsert** chaque asset en `candidate` (rejouable à l'identique
 * — même `id` stable) ; le figeage du Teddy canonique = **approbation** (`approved` + `approvedBy`),
 * un **sign-off propriétaire manuel** (WORLDGEN §8 « validé à la main », ADR 0008). Aucune
 * approbation automatique n'existe dans ce module : `approveAsset` exige un `approvedBy` non vide,
 * et rien n'appelle `approveAsset` dans l'outil de génération → le freeze reste une action humaine.
 */

/** Clé stable de l'asset **master** (Teddy canonique). */
export const MASTER_ASSET_ID = "teddy:master";

/** Clé stable d'une expression du model sheet (`teddy:expression:<slug>`). */
export function expressionAssetId(slug: string): string {
  return `teddy:expression:${slug}`;
}

/** Donnée d'un asset de référence à persister (produit par l'outil Stage A). */
export interface ReferenceAssetInput {
  id: string;
  kind: TeddyAssetKind;
  /** Slug d'expression (`kind = expression`) ou `null` (master). */
  expression: string | null;
  assetRef: string;
  backgroundStrategy: string;
  /** Fond transparent ? (détourage appliqué). */
  transparent: boolean;
  /** Empreinte du lot de photos (garde « photos consommées uniquement au Stage A »). */
  sourcePhotosHash: string;
}

/**
 * **Upsert** un asset de référence en `candidate`. Idempotent : rejouer Stage A remplace le
 * candidat au même `id` (pas de doublon) et **remet le statut à `candidate`** (un nouveau
 * candidat n'hérite jamais d'une approbation précédente — le master régénéré doit être re-validé
 * à la main). `approved_by` est remis à `NULL` au même titre.
 */
export function upsertCandidate(db: AppDatabase, input: ReferenceAssetInput): void {
  const values = {
    id: input.id,
    kind: input.kind,
    expression: input.expression,
    assetRef: input.assetRef,
    backgroundStrategy: input.backgroundStrategy,
    transparent: input.transparent ? 1 : 0,
    sourcePhotosHash: input.sourcePhotosHash,
    status: "candidate" as ReferenceAssetStatus,
    approvedBy: null,
  };
  db.insert(teddyReferenceAssets)
    .values(values)
    .onConflictDoUpdate({
      target: teddyReferenceAssets.id,
      set: {
        kind: values.kind,
        expression: values.expression,
        assetRef: values.assetRef,
        backgroundStrategy: values.backgroundStrategy,
        transparent: values.transparent,
        sourcePhotosHash: values.sourcePhotosHash,
        // Un candidat régénéré redevient non validé (WORLDGEN §8 : re-valider à la main).
        status: values.status,
        approvedBy: values.approvedBy,
      },
    })
    .run();
}

/** Un asset de référence lu depuis la base. */
export interface ReferenceAsset {
  id: string;
  kind: TeddyAssetKind;
  expression: string | null;
  assetRef: string;
  backgroundStrategy: string;
  transparent: boolean;
  status: ReferenceAssetStatus;
  approvedBy: string | null;
}

/** Ligne brute → `ReferenceAsset` (bool dérivé de l'entier SQLite 0/1). */
function toAsset(row: typeof teddyReferenceAssets.$inferSelect): ReferenceAsset {
  return {
    id: row.id,
    kind: row.kind,
    expression: row.expression,
    assetRef: row.assetRef,
    backgroundStrategy: row.backgroundStrategy,
    transparent: row.transparent !== 0,
    status: row.status,
    approvedBy: row.approvedBy,
  };
}

/** Tous les assets de référence (master + expressions), dans l'ordre d'insertion. */
export function listReferenceAssets(db: AppDatabase): ReferenceAsset[] {
  return db.select().from(teddyReferenceAssets).all().map(toAsset);
}

/**
 * Le master **approuvé** (Teddy canonique figé), ou `null` s'il n'existe pas encore ou reste
 * `candidate`. Le Stage B (par monde) ancre **exclusivement** sur ce master approuvé — jamais
 * un candidat non validé (WORLDGEN §8, ADR 0008).
 */
export function getApprovedMaster(db: AppDatabase): ReferenceAsset | null {
  const row = db
    .select()
    .from(teddyReferenceAssets)
    .where(
      and(
        eq(teddyReferenceAssets.id, MASTER_ASSET_ID),
        eq(teddyReferenceAssets.status, "approved"),
      ),
    )
    .limit(1)
    .get();
  return row ? toAsset(row) : null;
}

/** Erreur d'approbation d'un asset de référence (asset inconnu, ou approbateur vide). */
export class ReferenceApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceApprovalError";
  }
}

/**
 * **Fige** un asset de référence en `approved` avec l'identité de l'approbateur (sign-off
 * propriétaire manuel, WORLDGEN §8). Lève si l'asset est inconnu ou si `approvedBy` est vide
 * (un master ne peut pas être figé sans approbateur — garde le freeze **explicite**). Ce chemin
 * n'est **jamais** appelé par l'outil de génération : le figeage reste une action humaine.
 *
 * @returns l'asset approuvé.
 */
export function approveAsset(db: AppDatabase, id: string, approvedBy: string): ReferenceAsset {
  const who = approvedBy.trim();
  if (!who) {
    throw new ReferenceApprovalError("approbation refusée : approbateur (approvedBy) requis.");
  }
  const updated = db
    .update(teddyReferenceAssets)
    .set({ status: "approved", approvedBy: who })
    .where(eq(teddyReferenceAssets.id, id))
    .returning()
    .get();
  if (!updated) {
    throw new ReferenceApprovalError(`approbation refusée : asset de référence "${id}" inconnu.`);
  }
  return toAsset(updated);
}
