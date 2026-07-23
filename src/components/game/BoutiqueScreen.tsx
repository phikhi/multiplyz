"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import {
  boutiqueStateAction,
  buyEggAction,
  type BuyEggActionResult,
} from "@/app/(app)/boutique/actions";
import { AssetImage } from "@/components/media/AssetImage";
import { RarityBadge } from "@/components/game/CollectionScreen";

/**
 * **Écran Boutique / Œufs** (story R4.2 #393, WIREFRAMES §6, ECONOMY §4.2/§6/§7, COPY §3) — la boucle
 * de **DÉPENSE** cœur : acheter un œuf en pièces → tirage → **ouverture d'œuf** (créature révélée EN
 * GRAND). Tout est **server-authoritative** : `buyEggAction` débite, tire, possède, crédite les éclats
 * d'un doublon et met à jour la pitié dans UNE transaction ; ce composant ne fait qu'AFFICHER + relayer
 * l'intention d'achat (avec une clé d'idempotence opaque générée ici).
 *
 * **Moment d'ouverture = garde-MAGNITUDE (CLAUDE.md, règle promue)** : l'art de la créature tirée est le
 * HÉROS de l'écran de révélation — token DÉDIÉ `--egg-reveal-art-size` (~240px, EN GRAND), jamais une
 * vignette. La révélation est rendue **EN FLUX** (pas un overlay `absolute`/`fixed`) : non-occlusion
 * **STRUCTURELLE** (CLAUDE.md #278) — elle REMPLACE le contenu d'achat, elle ne le recouvre pas → aucun
 * risque d'occlusion à garder. La garde E2E asserte le SEUIL de magnitude rendue (`artBox.width >= 180`,
 * rougit à la régression), pas un plancher de présence (rétro R3.2 #379).
 *
 * **A11y** : le bloc de révélation est un `role="img"` au nom accessible explicite (nom de la créature) ;
 * l'art interne est **décoratif** (l'ancêtre porte le nom, pas de double annonce). Le titre du moment
 * (`L'œuf s'ouvre…`) est focalisé **au montage RÉEL** de la sous-arborescence de révélation (rendu
 * conditionnel → vrai mount, jamais un swap en place → hors STACK-TRAP #244). Cibles ≥ 44 px, tokens
 * texte fiables (`--collection-*`, ≥4.5:1 sur le fond de carte), `prefers-reduced-motion` respecté
 * nativement (aucune animation ajoutée). **Tokens only**, **strings centralisées** (voix de Teddy).
 *
 * **No-fail / no-FOMO (ECONOMY §1)** : solde insuffisant → message DOUX (« il te faut encore quelques
 * pièces »), jamais un blocage ni une pression ; doublon résolu avec JOIE (« +N ✨ »), jamais « rien ».
 */

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/** Fabrique une clé d'idempotence opaque par intention d'achat (uuid — dispo navigateur + Node ≥ 19). */
function makeDrawId(): string {
  return crypto.randomUUID();
}

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
};

const primaryCtaStyle: CSSProperties = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-6)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "none",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
};

const secondaryLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-2) var(--space-5)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  backgroundColor: "var(--color-bg-tertiary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-full)",
  textDecoration: "none",
};

/** Emoji décoratif de l'œuf (doublé du texte « Œuf surprise », a11y). */
const EGG_EMOJI = "🥚";
/** Emoji décoratif du repli quand l'art de la créature n'est pas rendable (`placeholder://`). */
const CREATURE_FALLBACK_EMOJI = "🐾";

/**
 * **Révélation de la créature tirée** (WIREFRAMES §6b) — art EN GRAND (`--egg-reveal-art-size`), beat
 * Teddy (nouvelle vs doublon), CTA « Génial ! ». Bloc `role="group"` au nom accessible (créature +
 * **rareté**, parité `collection.cardLabel`) : le lecteur d'écran annonce le nom+rareté PUIS le
 * contenu ANNONCÉ (le beat « +N ✨ » d'un doublon = seule surface du gain d'éclats, jamais silencieux ;
 * le nom/la rareté visibles sont des échos `aria-hidden`). L'art est **décoratif** (le groupe porte le
 * nom). EN FLUX → non-occlusion structurelle.
 */
function EggReveal({
  result,
  onDismiss,
}: {
  readonly result: Extract<BuyEggActionResult, { ok: true }>;
  readonly onDismiss: () => void;
}) {
  // Focus au MONTAGE RÉEL de la révélation (rendu conditionnel → vrai mount, pas un swap en place →
  // hors STACK-TRAP #244) : le titre du moment est annoncé au lecteur d'écran quand l'œuf s'ouvre.
  const focusOpeningOnMount = useCallback((node: HTMLParagraphElement | null) => {
    if (node !== null) node.focus();
  }, []);

  const beat = result.isNew
    ? strings.eggReveal.newFriend
    : fill(strings.eggReveal.duplicate, { éclats: String(result.shardsAwarded) });

  return (
    <>
      <p
        ref={focusOpeningOnMount}
        tabIndex={-1}
        data-egg-opening=""
        className="mz-focusable"
        style={{ ...headingStyle, outline: "none" }}
      >
        {strings.eggReveal.opening}
      </p>

      <div
        // `role="group"` (PAS `role="img"`) : le bloc porte un nom accessible (créature + rareté) MAIS
        // n'est PAS un nœud-feuille — le lecteur d'écran ANNONCE aussi son contenu textuel (le beat
        // « +N ✨ » d'un doublon = SEULE surface du gain d'éclats, jamais silencieux ; role="img"
        // pruderait ce contenu). Le nom + la rareté (redondants avec le label) restent des ÉCHOS
        // VISUELS `aria-hidden` (pas de double annonce), comme la carte légendaire des résultats.
        role="group"
        aria-label={fill(strings.eggReveal.creatureLabel, {
          nom: result.creature.displayName,
          rareté: strings.collection.rarity[result.creature.rarity],
        })}
        data-egg-reveal={result.creature.characterId}
        data-egg-reveal-new={result.isNew ? "true" : "false"}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-5)",
          maxWidth: "var(--max-width-play)",
          backgroundColor: "var(--collection-card-bg)",
          border: "1px solid var(--collection-card-border)",
          borderRadius: "var(--border-radius-lg)",
        }}
      >
        {/* Art EN GRAND = HÉROS de l'écran (garde-MAGNITUDE, `--egg-reveal-art-size`). `art_ref` rendable
            (`socle/creature/…`, R3.1) → VRAI art committé ; sinon repli emoji no-fail. Décoratif (le
            `role="img"` parent porte le nom). EN FLUX → aucune occlusion par construction (#170/#278). */}
        <AssetImage
          assetRef={result.creature.artRef}
          alt={result.creature.displayName}
          decorative
          width="var(--egg-reveal-art-size)"
          dataAsset="egg-reveal-art"
          fallback={
            <span
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "var(--egg-reveal-art-size)",
                height: "var(--egg-reveal-art-size)",
                borderRadius: "var(--border-radius-full)",
                backgroundColor: "var(--collection-placeholder-bg)",
                color: "var(--collection-placeholder-glyph)",
                fontSize: "var(--font-size-2xl)",
              }}
            >
              {CREATURE_FALLBACK_EMOJI}
            </span>
          }
        />
        {/* Nom + rareté = ÉCHOS VISUELS du nom accessible du bloc (`aria-hidden`, pas de double
            annonce) — le lecteur d'écran les entend déjà via l'`aria-label` du `role="group"` parent. */}
        <span
          aria-hidden="true"
          data-egg-reveal-name=""
          style={{
            fontFamily: "var(--font-family-display)",
            fontSize: "var(--font-size-lg)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--collection-text)",
          }}
        >
          {result.creature.displayName}
        </span>
        <span aria-hidden="true">
          <RarityBadge rarity={result.creature.rarity} />
        </span>
        {/* Beat Teddy : nouvelle → « un nouvel ami » ; doublon → « +N ✨ » (jamais « rien », ECONOMY §1).
            **ANNONCÉ** (pas d'`aria-hidden`) : pour un DOUBLON, c'est la SEULE surface qui porte le gain
            d'éclats → un lecteur d'écran DOIT l'entendre (parité avec le bandeau pitié ci-dessous). */}
        <p
          data-egg-reveal-beat=""
          style={{
            margin: 0,
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-md)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--collection-text-muted)",
            textAlign: "center",
          }}
        >
          {beat}
        </p>
        {/* Bandeau pitié (ECONOMY §7) — réassurance douce quand la garantie anti-malchance a agi. */}
        {result.pityApplied && (
          <p
            data-egg-reveal-pity=""
            style={{
              margin: 0,
              fontFamily: "var(--font-family-body)",
              fontSize: "var(--font-size-sm)",
              color: "var(--collection-text-muted)",
              textAlign: "center",
            }}
          >
            {strings.eggReveal.pity}
          </p>
        )}
      </div>

      <button type="button" className="mz-focusable" onClick={onDismiss} style={primaryCtaStyle}>
        {strings.eggReveal.dismiss}
      </button>
    </>
  );
}

/** État réactif de l'écran boutique. */
type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly eggPriceCoins: number;
      readonly coins: number;
      readonly shards: number;
      /** Message doux transitoire (« pas les moyens ») affiché sous le bouton, jamais bloquant. */
      readonly notice: string | null;
    }
  | { readonly kind: "buying"; readonly eggPriceCoins: number }
  | { readonly kind: "revealed"; readonly result: Extract<BuyEggActionResult, { ok: true }> };

/** Orchestrateur client de l'écran boutique — charge l'état serveur au montage puis relaie les achats. */
export function BoutiqueScreen() {
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });

  const fetchState = useCallback(async () => {
    const result = await boutiqueStateAction();
    if (!result.ok) {
      setScreen({ kind: "error" });
      return;
    }
    setScreen({
      kind: "ready",
      eggPriceCoins: result.eggPriceCoins,
      coins: result.coins,
      shards: result.shards,
      notice: null,
    });
  }, []);

  const retry = useCallback(() => {
    setScreen({ kind: "loading" });
    void fetchState();
  }, [fetchState]);

  useEffect(() => {
    // Différé en microtâche (react-hooks/set-state-in-effect, même pattern que CollectionScreen).
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void fetchState();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchState]);

  const buyEgg = useCallback(async (eggPriceCoins: number, coins: number, shards: number) => {
    // Le passage en `buying` DÉMONTE le bouton d'achat → aucun double-tir possible côté UI (pas
    // besoin d'un verrou `inFlight` redondant, règle #124). Le `drawId` protège en plus côté serveur.
    setScreen({ kind: "buying", eggPriceCoins });
    const result = await buyEggAction(makeDrawId());
    if (result.ok) {
      setScreen({ kind: "revealed", result });
      return;
    }
    // No-fail : solde insuffisant → indice DOUX (jamais bloquant). Toute autre issue → même posture
    // douce (invitation à réessayer), on ne fabrique pas d'écran d'erreur dur. AUCUN débit n'a eu lieu
    // sur un échec (BROKE/REPLAY/NO_POOL/… : anti-négatif serveur) → le solde est INCHANGÉ, on le
    // restaure tel quel (jamais un refetch qui effacerait l'indice affiché).
    const notice = result.error === "BROKE" ? strings.boutique.broke : strings.boutique.loadError;
    setScreen({ kind: "ready", eggPriceCoins, coins, shards, notice });
  }, []);

  const dismissReveal = useCallback(() => {
    setScreen({ kind: "loading" });
    void fetchState();
  }, [fetchState]);

  return (
    <main
      className="bg-bg text-text"
      style={{
        minHeight: "calc(100dvh - var(--app-shell-height))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-5)",
        padding: "var(--space-6) var(--space-4)",
      }}
    >
      {screen.kind === "loading" && (
        <h1 role="status" style={headingStyle}>
          {strings.boutique.loading}
        </h1>
      )}

      {screen.kind === "error" && (
        <>
          <h1 style={headingStyle}>{strings.boutique.loadError}</h1>
          <button type="button" className="mz-focusable" onClick={retry} style={primaryCtaStyle}>
            {strings.boutique.loadErrorRetry}
          </button>
        </>
      )}

      {screen.kind === "buying" && (
        <h1 role="status" data-egg-buying="" style={headingStyle}>
          {strings.boutique.buying}
        </h1>
      )}

      {screen.kind === "revealed" && <EggReveal result={screen.result} onDismiss={dismissReveal} />}

      {screen.kind === "ready" && (
        <>
          <h1 style={headingStyle}>{strings.boutique.title}</h1>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-md)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--collection-text-muted)",
            }}
          >
            {strings.boutique.eggsHeading}
          </h2>

          <div
            data-egg-card=""
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-4)",
              padding: "var(--space-6)",
              maxWidth: "var(--max-width-play)",
              backgroundColor: "var(--collection-card-bg)",
              border: "1px solid var(--collection-card-border)",
              borderRadius: "var(--border-radius-lg)",
            }}
          >
            <span
              aria-hidden="true"
              style={{ fontSize: "var(--egg-reveal-art-size)", lineHeight: 1 }}
            >
              {EGG_EMOJI}
            </span>
            <span
              style={{
                fontFamily: "var(--font-family-display)",
                fontSize: "var(--font-size-lg)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--collection-text)",
              }}
            >
              {strings.boutique.eggName}
            </span>
            <button
              type="button"
              className="mz-focusable"
              data-egg-buy=""
              onClick={() => void buyEgg(screen.eggPriceCoins, screen.coins, screen.shards)}
              style={primaryCtaStyle}
            >
              {fill(strings.boutique.buy, { prix: String(screen.eggPriceCoins) })}
            </button>
            {screen.notice !== null && (
              <p
                role="status"
                data-egg-notice=""
                style={{
                  margin: 0,
                  fontFamily: "var(--font-family-body)",
                  fontSize: "var(--font-size-md)",
                  color: "var(--collection-text-muted)",
                  textAlign: "center",
                }}
              >
                {screen.notice}
              </p>
            )}
          </div>

          <Link href="/carte" className="mz-focusable" style={secondaryLinkStyle}>
            {strings.boutique.back}
          </Link>
        </>
      )}
    </main>
  );
}
