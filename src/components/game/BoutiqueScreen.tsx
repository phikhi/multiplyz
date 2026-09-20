"use client";

import { useCallback } from "react";
import Link from "next/link";
import { eggShop as copy } from "@/strings/egg-shop";
import { shardShop } from "@/strings/shard-shop";
import { useEggShop } from "@/lib/game/use-egg-shop";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";
import { ForestScene } from "./ForestScene";
import { CompanionArt, RarityBadge } from "./CollectionScreen";

/** A quiet, hand-shaped egg. Decorative; opening remains an ordinary keyboard-accessible button. */
function ForestEgg() {
  return (
    <div className="egg-nest" aria-hidden="true">
      <div className="egg-shell">
        <svg viewBox="0 0 80 100">
          <path d="M40 82V38M40 60C12 64 11 40 14 24C35 28 40 42 40 60ZM40 46C64 45 70 25 64 12C44 15 39 29 40 46Z" />
        </svg>
      </div>
    </div>
  );
}

export function BoutiqueScreen() {
  const flow = useEggShop();
  const reduced = usePrefersReducedMotion();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  const { shop, receipt, revealed, busy, error } = flow;
  const result = receipt?.result;
  const phase = result ? (revealed ? "encounter" : "egg") : shop ? "shop" : "loading";
  const title =
    phase === "encounter" && result
      ? copy.named(result.creature.displayName)
      : phase === "egg"
        ? copy.waiting
        : phase === "loading"
          ? copy.loading
          : copy.title;
  const notice =
    error === "NETWORK"
      ? copy.network
      : error === "STORAGE"
        ? copy.storage
        : error === "UNAUTHENTICATED"
          ? copy.auth
          : error === "BROKE"
            ? copy.broke
            : copy.error;
  const coins = shop?.coins ?? 0;
  const price = shop?.eggPriceCoins ?? 0;
  const missing = Math.max(0, price - coins);

  return (
    <main className="forest forest-shop" data-shop-phase={phase}>
      <ForestScene
        completed={0}
        total={10}
        phase="question"
        paused={false}
        reduced={reduced}
        showFriend={false}
      />
      <div className="egg-shop-inner">
        <nav className="companion-nav">
          <Link href="/carte">{copy.back}</Link>
          <Link href="/collection">{copy.collection}</Link>
        </nav>
        <header className="egg-shop-heading">
          <p className="forest-kicker">
            {result
              ? revealed
                ? result.isNew
                  ? copy.newFriend
                  : copy.reunion
                : copy.eyebrow
              : copy.eyebrow}
          </p>
          <h1 key={`${phase}:${busy}:${error}`} tabIndex={-1} ref={focusHeading}>
            {title}
          </h1>
          {phase === "shop" && <p>{copy.intro}</p>}
        </header>
        {error && (
          <aside className="egg-network" role="alert">
            <p>{notice}</p>
            {error === "UNAUTHENTICATED" ? (
              <Link className="forest-primary" href="/">
                {copy.login}
              </Link>
            ) : (
              <button className="forest-primary" disabled={busy} onClick={() => void flow.retry()}>
                {copy.retry}
              </button>
            )}
          </aside>
        )}
        {busy && (
          <p className="egg-pending" role="status">
            {shop ? copy.buying : copy.loading}
          </p>
        )}
        {shop && !receipt && (
          <div className="egg-shop-layout">
            <div className="egg-presentation">
              <ForestEgg />
              <p>{copy.eggName}</p>
            </div>
            <section className="companion-biography egg-offer" aria-label={copy.eggName}>
              <dl className="egg-wallet">
                <div>
                  <dt>{copy.coins}</dt>
                  <dd data-shop-coins="">{coins}</dd>
                </div>
                <div>
                  <dt>{copy.shards}</dt>
                  <dd data-shop-shards="">{shop.shards}</dd>
                </div>
              </dl>
              <h2>{copy.eggName}</h2>
              <p>{copy.eggDescription}</p>
              <p className="egg-price">{copy.price(price)}</p>
              {!shop.available ? (
                <p>{copy.unavailable}</p>
              ) : missing > 0 ? (
                <p>{copy.missing(missing)}</p>
              ) : (
                <p>{copy.after(coins - price)}</p>
              )}
              <div className="egg-actions">
                {shop.available && missing === 0 && (
                  <button
                    className="forest-primary"
                    data-egg-buy=""
                    disabled={busy || error !== null}
                    onClick={flow.buy}
                  >
                    {copy.buy(price)}
                  </button>
                )}
                <Link href="/carte" className="forest-secondary">
                  {copy.continue}
                </Link>
              </div>
              <p className="egg-rules">{copy.rules}</p>
              <Link className="forest-secondary shard-shop-link" href="/boutique/eclats">
                {shardShop.link}
              </Link>
            </section>
            <aside className="egg-guide">
              <p>{copy.duplicateHint}</p>
              <p>{copy.guardianHint}</p>
            </aside>
          </div>
        )}
        {result && !revealed && (
          <section className="egg-opening">
            <ForestEgg />
            <div className="egg-opening-copy">
              <p>{copy.paid(result.balance.coins)}</p>
              <button
                className="forest-primary"
                data-egg-open=""
                disabled={busy}
                onClick={flow.open}
              >
                {copy.open}
              </button>
              <p>{copy.openHint}</p>
            </div>
          </section>
        )}
        {result && revealed && (
          <section className="egg-shop-layout egg-encounter" data-egg-reveal="">
            <figure className="companion-portrait" data-egg-character={result.creature.characterId}>
              <CompanionArt
                artRef={result.creature.artRef}
                name={result.creature.displayName}
                dataAsset="egg-reveal-creature"
              />
            </figure>
            <div className="companion-biography">
              <RarityBadge rarity={result.creature.rarity} />
              <h2>{result.creature.displayName}</h2>
              <p>{result.creature.story}</p>
              <p>
                {result.isNew
                  ? copy.newHint
                  : copy.duplicate(result.creature.displayName, result.shardsAwarded)}
              </p>
              {!result.isNew && (
                <p className="egg-shards" data-egg-shards="">
                  {copy.shardsGain(result.shardsAwarded)}
                </p>
              )}
              {result.pityApplied && <p>{copy.pity}</p>}
              <p className="egg-saved">{copy.saved}</p>
              <div className="egg-actions">
                <button
                  className="forest-primary"
                  disabled={busy}
                  onClick={() => flow.close("companion")}
                >
                  {copy.visit}
                </button>
                <button
                  className="forest-secondary"
                  disabled={busy}
                  onClick={() => flow.close("shop")}
                >
                  {copy.returnShop}
                </button>
                <button
                  className="forest-secondary"
                  disabled={busy}
                  onClick={() => flow.close("map")}
                >
                  {copy.continue}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
