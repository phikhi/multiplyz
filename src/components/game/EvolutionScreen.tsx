"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { evolution as copy } from "@/strings/evolution";
import { forest } from "@/strings/forest";
import { useEvolution } from "@/lib/game/use-evolution";
import type { EvolutionState } from "@/lib/game/evolution-types";
import { assetPublicUrl } from "@/lib/game/world-theme";
import { CompanionArt } from "./CollectionScreen";

/** The real image must load before consent; no visual-only fake growth on a missing asset. */
function GrowthPortrait({
  artRef,
  name,
  onReady,
}: {
  artRef: string;
  name: string;
  onReady: (ready: boolean) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const loaded = useCallback(() => {
    setStatus("ready");
    onReady(true);
  }, [onReady]);
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      // The browser may finish the server-rendered image before React hydrates it.
      if (image?.complete && image.naturalWidth > 0) loaded();
    },
    [loaded],
  );
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- actual asset load gates cosmetic consent */}
      <img
        ref={imageRef}
        src={assetPublicUrl(artRef)}
        alt={name}
        data-asset="evolution-next"
        onLoad={loaded}
        onError={() => {
          setStatus("error");
          onReady(false);
        }}
      />
      {status !== "ready" && (
        <p role="status">{status === "error" ? copy.imageError : copy.imageLoading}</p>
      )}
    </>
  );
}

export function EvolutionScreen({ initial }: { initial: EvolutionState }) {
  const { state, receipt, busy, error, retry, grow, close } = useEvolution(initial);
  const [readyRef, setReadyRef] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const offer = receipt?.offer ?? state.offer;
  const name = state.entry.displayName;
  const detail = `/collection/${encodeURIComponent(state.entry.characterId)}`;
  const nextRef = offer?.afterArtRef ?? null;
  const portraitReady = useCallback(
    (ready: boolean) => setReadyRef(ready ? nextRef : null),
    [nextRef],
  );
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [busy, receipt, error]);
  return (
    <main className="forest companion-page evolution-page">
      <div className="companion-page-inner">
        <nav className="companion-nav">
          <Link href={detail}>{copy.back}</Link>
          <Link href="/carte">{forest.returnMap}</Link>
        </nav>
        <header className="companion-heading">
          <p className="forest-kicker">{copy.kicker}</p>
          <h1
            ref={heading}
            tabIndex={-1}
            key={receipt ? `grown-${receipt.offer.toStage}` : "preview"}
          >
            {receipt ? copy.grown(name) : copy.title}
          </h1>
          <p>{copy.description}</p>
        </header>
        {offer ? (
          <div className="evolution-layout" data-evolution-phase={receipt ? "grown" : "preview"}>
            <div className="evolution-portraits">
              <figure className="evolution-before">
                <figcaption>
                  {receipt ? copy.before : copy.current}
                  <strong>{copy.stage[offer.fromStage]}</strong>
                </figcaption>
                <CompanionArt
                  artRef={offer.beforeArtRef}
                  name={name}
                  dataAsset="evolution-before"
                />
              </figure>
              <figure className="evolution-after">
                <figcaption>
                  {receipt ? copy.now : copy.next}
                  <strong>{copy.stage[offer.toStage]}</strong>
                </figcaption>
                <GrowthPortrait
                  key={offer.afterArtRef}
                  artRef={offer.afterArtRef}
                  name={`${name} · ${copy.stage[offer.toStage]}`}
                  onReady={portraitReady}
                />
              </figure>
            </div>
            <section className="companion-biography evolution-consent" aria-busy={busy}>
              <h2>{name}</h2>
              {receipt ? (
                <>
                  <p>{copy.spent(offer.price)}</p>
                  <p>{copy.historical(receipt.balance.shards)}</p>
                  <button className="forest-primary" onClick={close} disabled={busy || !!error}>
                    {busy ? copy.saving : copy.return(name)}
                  </button>
                </>
              ) : (
                <>
                  <p className="evolution-cost">{copy.cost(offer.price)}</p>
                  <p>{copy.balance(state.shards)}</p>
                  {state.shards >= offer.price ? (
                    <>
                      <p>{copy.after(state.shards - offer.price)}</p>
                      <button
                        className="forest-primary"
                        onClick={grow}
                        disabled={busy || !!error || readyRef !== offer.afterArtRef}
                      >
                        {busy ? copy.loading : copy.confirm(offer.price)}
                      </button>
                    </>
                  ) : (
                    <>
                      <p>{copy.missing(offer.price - state.shards)}</p>
                      <p>{copy.earn}</p>
                      <Link className="forest-primary" href="/carte">
                        {forest.returnMap}
                      </Link>
                    </>
                  )}
                  <Link className="evolution-cancel" href={detail}>
                    {copy.keep}
                  </Link>
                </>
              )}
              <p className="evolution-cosmetic">{copy.cosmetic}</p>
            </section>
          </div>
        ) : (
          <section className="companion-biography">
            <p>{state.entry.stage >= 3 ? copy.complete : copy.unavailable}</p>
            <Link className="forest-primary" href={detail}>
              {copy.back}
            </Link>
          </section>
        )}
        {error && (
          <div className="companion-biography evolution-error" role="alert">
            <p>{copy.errors[error]}</p>
            <button className="forest-primary" disabled={busy} onClick={() => void retry()}>
              {copy.retry}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
