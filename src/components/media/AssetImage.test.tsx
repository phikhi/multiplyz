import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssetImage } from "@/components/media/AssetImage";

const ALT = "Teddy te fait coucou";
const FALLBACK = <span data-testid="fallback">🧸</span>;

/** Rend un `<AssetImage>` avec le ref donné (helper de lisibilité). */
function renderAsset(assetRef: string | null) {
  return render(
    <AssetImage
      assetRef={assetRef}
      alt={ALT}
      width="var(--teddy-hero-size)"
      dataAsset="teddy-test"
      fallback={FALLBACK}
    />,
  );
}

describe("AssetImage — renderer guardé partagé (story R2.2, #360)", () => {
  it("ref RENDABLE → <img> dont la src est l'URL publique validée + alt consommé", () => {
    renderAsset("socle/teddy/content.png");
    const img = screen.getByRole("img", { name: ALT });
    expect(img.tagName).toBe("IMG");
    // src = assetPublicUrl(ref) — jamais le ref brut, jamais une URL arbitraire.
    expect(img).toHaveAttribute("src", "/generated/socle/teddy/content.png");
    // a11y : alt réellement consommé sur l'élément (#239/#125), pas seulement déclaré.
    expect(img).toHaveAttribute("alt", ALT);
    expect(img).toHaveAttribute("data-asset", "teddy-test");
    expect(img).toHaveAttribute("data-asset-state", "rendered");
    // Aucun repli tant que l'image n'a pas échoué.
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });

  // ▶▶ Garde de SÉCURITÉ mutation-prouvée ◀◀ : un `placeholder://…` NE DOIT JAMAIS devenir une
  // <img> fetchée. Ce test ROUGIT si la garde `isRenderableAssetRef` saute de `renderable` (un
  // <img src="placeholder://…"> apparaîtrait, le repli disparaîtrait). Effet observable distinct.
  it("ref NON RENDABLE (placeholder://) → repli, JAMAIS d'<img>", () => {
    renderAsset("placeholder://socle/teddy/content.png");
    expect(screen.queryByRole("img", { name: ALT })?.tagName).not.toBe("IMG");
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    // Le repli porte la MÊME a11y que l'image (role img + aria-label consommé).
    const fallback = screen.getByRole("img", { name: ALT });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback).toHaveAttribute("data-asset-state", "fallback");
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  // Une URL arbitraire (schéma/hôte) est refusée par la MÊME garde → jamais fetchée (défense en
  // profondeur : le composant n'accepte qu'un ref, jamais une URL).
  it("ref en forme d'URL arbitraire (http://…) → repli, jamais d'<img> vers l'hôte", () => {
    renderAsset("http://evil.example/x.png");
    const el = screen.getByRole("img", { name: ALT });
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("data-asset-state", "fallback");
  });

  it("ref null → repli no-fail (asset non fourni)", () => {
    renderAsset(null);
    const el = screen.getByRole("img", { name: ALT });
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("data-asset", "teddy-test");
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  // ▶▶ Garde onError mutation-prouvée ◀◀ : une image servie mais qui échoue à charger (asset non
  // déployé / décodage) bascule vers le repli. ROUGIT si `onError` est retiré (l'<img> cassée
  // resterait, le repli n'apparaîtrait jamais). No-fail : la boucle n'est jamais bloquée.
  it("<img> qui échoue (onError) → bascule vers le repli", () => {
    renderAsset("socle/teddy/content.png");
    const img = screen.getByRole("img", { name: ALT });
    expect(img.tagName).toBe("IMG");
    fireEvent.error(img);
    const fallback = screen.getByRole("img", { name: ALT });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback).toHaveAttribute("data-asset-state", "fallback");
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    // L'<img> cassée n'est plus dans le DOM.
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("AssetImage — mode décoratif (story R2.1, #361 — art dont l'ancêtre porte déjà le nom)", () => {
  function renderDecorative(assetRef: string | null) {
    return render(
      <AssetImage
        assetRef={assetRef}
        alt={ALT}
        width="var(--collection-placeholder-size)"
        dataAsset="creature-test"
        fallback={FALLBACK}
        decorative
      />,
    );
  }

  // ▶▶ décoratif + rendable → <img alt=""> ◀◀ : rend le VRAI art (garde renderable→img, chemin
  // format-réel #189) MAIS sans nom accessible propre (alt="" → l'<img> est décoratif/ignoré des
  // lecteurs d'écran) : le nom est porté par l'ANCÊTRE labellé (carte/légendaire, prouvé côté écran).
  // ROUGIT si l'art décoratif ré-annonçait `alt={alt}` (double annonce) OU si la garde renderable
  // sautait (repli à la place de l'<img>).
  it('décoratif + ref RENDABLE → <img> réel avec alt="" (aucune double annonce), src validée', () => {
    renderDecorative("socle/creature/cloudfox.png");
    const img = document.querySelector<HTMLImageElement>('[data-asset="creature-test"]');
    expect(img?.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/generated/socle/creature/cloudfox.png");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("data-asset-state", "rendered");
    // alt="" ⇒ jamais annoncé sous le nom du sujet (pas de double annonce avec l'ancêtre).
    expect(screen.queryByRole("img", { name: ALT })).not.toBeInTheDocument();
  });

  // ▶▶ décoratif + placeholder → repli aria-hidden SANS role/aria-label ◀◀ : même a11y que l'ancien
  // placeholder emoji `aria-hidden` que le swap remplace (aucune double annonce avec l'ancêtre).
  // ROUGIT si la garde renderable sautait (un <img src="placeholder://…"> apparaîtrait) OU si le
  // repli décoratif ré-exposait `role="img"`+`aria-label`.
  it("décoratif + ref NON RENDABLE (placeholder://) → repli aria-hidden sans role/aria-label", () => {
    renderDecorative("placeholder://legendary/0");
    const fallback = document.querySelector<HTMLElement>('[data-asset="creature-test"]');
    expect(fallback?.tagName).toBe("SPAN");
    expect(fallback).toHaveAttribute("data-asset-state", "fallback");
    expect(fallback).toHaveAttribute("aria-hidden", "true");
    expect(fallback).not.toHaveAttribute("role");
    expect(fallback).not.toHaveAttribute("aria-label");
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    // Décoratif : aucun élément annoncé (ni sous le nom du sujet) et aucune <img> vers un placeholder.
    expect(screen.queryByRole("img", { name: ALT })).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
