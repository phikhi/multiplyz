"use client";

import { type CSSProperties, type ReactNode, useCallback, useState } from "react";
import { assetPublicUrl, isRenderableAssetRef } from "@/lib/game/world-theme";

/**
 * **Rendu d'image d'asset GUARDÉ partagé** (story R2.2, #360) — le seul point d'entrée pour rendre
 * un asset généré (Teddy, décor, plus tard l'art de créature R2.1) à l'écran. Il **réutilise la
 * garde de sécurité existante** `isRenderableAssetRef` (`world-theme.ts`) : il n'accepte qu'un
 * **ref d'asset** (`socle/…`/`world/…`, forme Nginx relative validée), **jamais une URL arbitraire**
 * fournie par un appelant. La src du `<img>` est **toujours** `assetPublicUrl(refValidé)` — un ref
 * `null`, `placeholder://…`, schéma exotique ou traversée `..` ne devient JAMAIS une URL fetchée :
 * il retombe sur le `fallback` (défense en profondeur identique à la carte, story 6.7/#190).
 *
 * **Repli no-fail** (`fallback`) : rendu (a) quand le ref n'est pas rendable (placeholder du gate
 * owner, CI sans assets, ref malformé) OU (b) quand l'image échoue à charger (`onError` — asset non
 * déployé/décodage). L'apprentissage/la boucle ne sont JAMAIS bloqués par un asset manquant (ART :
 * « QA kid-safe + fallback »). Le repli porte la **même a11y** que l'image (`role="img"` +
 * `aria-label={alt}`) → l'annonce lecteur d'écran est identique quel que soit l'état.
 *
 * **A11y (#239/#125)** : `alt` vient des **strings centralisées** (jamais un texte en dur) et est
 * **réellement consommé** — attribut `alt` sur l'`<img>`, `aria-label` sur le repli (asserté). `alt`
 * décrit l'expression/émotion de Teddy (voix de Teddy) : c'est du **contenu** ici (l'écran gagne en
 * chaleur), pas un décor muet — d'où un alt signifiant plutôt qu'`alt=""`. **Exception `decorative`
 * (story R2.1, #361)** : quand un ANCÊTRE porte déjà le nom accessible de l'illustration (carte de
 * créature `<li aria-label>`, révélation légendaire `<div role="img">`), l'art devient **décoratif**
 * (`alt=""` + repli `aria-hidden`, sans `role`/`aria-label`) pour éviter la double annonce — même
 * a11y que l'ancien placeholder emoji `aria-hidden` que le swap remplace (cf. prop `decorative`).
 *
 * **Hydratation (#305)** : l'état initial (serveur + 1er rendu client) rend TOUJOURS l'`<img>`
 * (`errored=false`) — aucune branche dépendante de `window`/`useSyncExternalStore` → **aucun**
 * mismatch SSR/CSR. Le basculement vers le repli n'arrive qu'APRÈS le montage, via l'événement
 * `onError` du navigateur (transition client légitime, pas un mismatch).
 *
 * **Non-occlusion STRUCTURELLE (#170/#190/#278b)** : ce composant rend l'image **EN FLUX** (pas de
 * `position:absolute`/`z-index`) → il réserve un espace réel et pousse le contenu, il ne peut pas
 * occulter par construction (contrairement au `CurrentNodeTeddy` absolu de la carte, qui exige une
 * garde géométrie E2E). Les tailles viennent de tokens (`--teddy-*`, tokens.css), jamais en dur.
 */
export interface AssetImageProps {
  /** Ref d'asset (`socle/…`/`world/…`) à valider+rendre, ou `null` → repli. JAMAIS une URL. */
  readonly assetRef: string | null;
  /** Nom accessible (string centralisée, non vide) — consommé en `alt` (img) / `aria-label` (repli). */
  readonly alt: string;
  /** Repli no-fail (emoji/silhouette décoratif) quand le ref n'est pas rendable ou l'image échoue. */
  readonly fallback: ReactNode;
  /** Largeur (token, ex. `var(--teddy-hero-size)`). La hauteur suit le ratio intrinsèque du sprite. */
  readonly width: string;
  /** Marqueur de sélection stable (tests/E2E) — posé sur l'`<img>` ET sur le repli (`data-asset`). */
  readonly dataAsset: string;
  /**
   * **Décoratif** (défaut `false`) — quand un ANCÊTRE porte déjà le nom accessible de l'illustration
   * (carte de créature `<li aria-label>`, révélation de la légendaire `<div role="img">`), l'art est
   * un **doublon a11y** : le rendre décoratif (`alt=""` sur l'`<img>`, `aria-hidden` + PAS de
   * `role`/`aria-label` sur le repli) évite la double annonce — c'est la même a11y que l'ancien
   * placeholder emoji `aria-hidden`, préservée par le swap. Teddy (contenu, aucun ancêtre labellé)
   * garde le défaut `false` → `alt` consommé (#239/#125). `alt` documente alors le SUJET (nom de la
   * créature) mais n'est PAS rendu comme nom accessible (l'ancêtre le porte, prouvé côté écran).
   */
  readonly decorative?: boolean;
}

export function AssetImage({
  assetRef,
  alt,
  fallback,
  width,
  dataAsset,
  decorative = false,
}: AssetImageProps) {
  const [errored, setErrored] = useState(false);
  const onError = useCallback(() => setErrored(true), []);

  // Sécurité : un ref non rendable (null/placeholder/schéma/traversée) ne devient JAMAIS une URL.
  const renderable = assetRef !== null && isRenderableAssetRef(assetRef);

  if (!renderable || errored) {
    const fallbackStyle: CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width,
      lineHeight: 1,
    };
    // Décoratif : `aria-hidden` + aucun `role`/`aria-label` (l'ancêtre labellé porte le nom).
    // Sinon : `role="img"` + `aria-label={alt}` (repli au MÊME nom accessible que l'image, #239).
    return (
      <span
        {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": alt })}
        data-asset={dataAsset}
        data-asset-state="fallback"
        style={fallbackStyle}
      >
        {fallback}
      </span>
    );
  }

  const imageStyle: CSSProperties = {
    display: "block",
    width,
    height: "auto",
    objectFit: "contain",
  };
  return (
    // src = assetPublicUrl d'un ref DÉJÀ validé (garde ci-dessus) — jamais une URL arbitraire.
    // `<img>` natif (pas `next/image`) volontaire : on a besoin de l'`alt` natif (AC a11y : alt
    // consommé, #239) ET de `onError` → repli no-fail (`next/image` ne gère pas le repli sur
    // échec, et l'optimisation d'un sprite décoratif 64–128px n'apporte rien — pas d'enjeu LCP).
    // eslint-disable-next-line @next/next/no-img-element -- cf. justification ci-dessus (alt + onError + repli)
    <img
      src={assetPublicUrl(assetRef)}
      // Décoratif → `alt=""` (l'ancêtre labellé porte le nom, pas de double annonce) ; sinon `alt`
      // consommé (contenu, #239). Un `<img alt="">` est ignoré des lecteurs d'écran (décoratif).
      alt={decorative ? "" : alt}
      data-asset={dataAsset}
      data-asset-state="rendered"
      onError={onError}
      style={imageStyle}
    />
  );
}
