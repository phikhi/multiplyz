"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { shardShop as copy } from "@/strings/shard-shop";
import { eggShop } from "@/strings/egg-shop";
import { companions } from "@/strings/companions";
import { useShardShop } from "@/lib/game/use-shard-shop";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";
import { ForestScene } from "./ForestScene";
import { CompanionArt, RarityBadge } from "./CollectionScreen";

export function ShardShopScreen() {
  const flow = useShardShop();
  const reduced = usePrefersReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  const { shop, receipt, busy, error } = flow;
  const selected = shop?.offers.find((item) => item.characterId === selectedId);
  const offer = receipt?.offer ?? selected;
  const phase = receipt ? "encounter" : offer ? "choice" : shop ? "catalogue" : "loading";
  const worlds = [...new Set(shop?.offers.map((item) => item.worldIndex))];
  const title = receipt
    ? copy.welcome(receipt.offer.displayName)
    : offer
      ? copy.confirmTitle(offer.displayName)
      : shop
        ? copy.title
        : copy.loading;
  const missing = Math.max(0, (offer?.price ?? 0) - (shop?.shards ?? 0));
  const notice =
    error === "NETWORK"
      ? copy.network
      : error === "STORAGE"
        ? eggShop.storage
        : error === "UNAUTHENTICATED"
          ? eggShop.auth
          : error === "OWNED"
            ? copy.owned
            : error === "BROKE"
              ? copy.broke
              : error === "UNAVAILABLE"
                ? copy.unavailable
                : copy.error;

  return (
    <main className="forest forest-shop shard-shop" data-shard-phase={phase}>
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
          <Link href="/boutique">{copy.shop}</Link>
          <Link href="/collection">{eggShop.collection}</Link>
          <Link href="/carte">{eggShop.back}</Link>
        </nav>
        <header className="egg-shop-heading">
          <p className="forest-kicker">{receipt ? eggShop.newFriend : copy.eyebrow}</p>
          <h1
            key={`${phase}:${offer?.characterId}:${busy}:${error}`}
            tabIndex={-1}
            ref={focusHeading}
          >
            {title}
          </h1>
          {phase === "catalogue" && <p>{copy.intro}</p>}
        </header>
        {error && (
          <aside className="egg-network" role="alert">
            <p>{notice}</p>
            {error === "UNAUTHENTICATED" ? (
              <Link className="forest-primary" href="/">
                {eggShop.login}
              </Link>
            ) : (
              <button className="forest-primary" disabled={busy} onClick={() => void flow.retry()}>
                {eggShop.retry}
              </button>
            )}
          </aside>
        )}
        {busy && (
          <p className="egg-pending" role="status">
            {shop ? copy.saving : copy.loading}
          </p>
        )}
        {phase === "catalogue" && shop && (
          <>
            <div className="shard-wallet">
              <span>{copy.wallet}</span>
              <strong data-shard-balance="">{shop.shards}</strong>
              <p>{copy.guide}</p>
            </div>
            {shop.offers.length === 0 && (
              <aside className="egg-guide">
                <p>{copy.empty}</p>
                <Link className="forest-primary" href="/carte">
                  {eggShop.continue}
                </Link>
              </aside>
            )}
            {worlds.map((worldIndex) => (
              <section
                className="shard-family"
                key={worldIndex}
                aria-labelledby={`shard-world-${worldIndex}`}
              >
                <h2 id={`shard-world-${worldIndex}`}>{companions.family(worldIndex + 1)}</h2>
                <ul className="shard-grid">
                  {shop.offers
                    .filter((item) => item.worldIndex === worldIndex)
                    .map((item) => (
                      <li key={item.characterId}>
                        <button
                          className="shard-choice"
                          data-shard-choice={item.characterId}
                          disabled={busy || error !== null}
                          onClick={() => setSelectedId(item.characterId)}
                        >
                          <div className="companion-card-art">
                            <CompanionArt
                              artRef={item.artRef}
                              name={item.displayName}
                              dataAsset="shard-candidate"
                              decorative
                            />
                          </div>
                          <span className="shard-name">{item.displayName}</span>
                          <RarityBadge rarity={item.rarity} />
                          <span className="shard-cost">{copy.price(item.price)}</span>
                          <span>{copy.choose(item.displayName)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {offer && (
          <section className="egg-shop-layout egg-encounter">
            <figure className="companion-portrait" data-shard-character={offer.characterId}>
              <CompanionArt
                artRef={offer.artRef}
                name={offer.displayName}
                dataAsset="shard-companion"
              />
            </figure>
            <div className="companion-biography">
              <RarityBadge rarity={offer.rarity} />
              <h2>{offer.displayName}</h2>
              <p>{offer.story}</p>
              {receipt ? (
                <>
                  <p>{copy.saved}</p>
                  <p className="egg-saved">{copy.paid(offer.price, receipt.balance.shards)}</p>
                  <div className="egg-actions">
                    <button
                      className="forest-primary"
                      disabled={busy || error !== null}
                      onClick={() => flow.close("companion")}
                    >
                      {eggShop.visit}
                    </button>
                    <button
                      className="forest-secondary"
                      disabled={busy || error !== null}
                      onClick={() => flow.close("shop")}
                    >
                      {eggShop.returnShop}
                    </button>
                    <button
                      className="forest-secondary"
                      disabled={busy || error !== null}
                      onClick={() => flow.close("map")}
                    >
                      {eggShop.continue}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <dl className="egg-wallet">
                    <div>
                      <dt>{copy.wallet}</dt>
                      <dd data-shard-balance="">{shop?.shards}</dd>
                    </div>
                  </dl>
                  <p className="egg-price">{copy.price(offer.price)}</p>
                  <p>
                    {missing > 0
                      ? copy.missing(missing)
                      : copy.after((shop?.shards ?? 0) - offer.price)}
                  </p>
                  <div className="egg-actions">
                    {missing === 0 && (
                      <button
                        className="forest-primary"
                        data-shard-buy=""
                        disabled={busy || error !== null}
                        onClick={() => flow.buy(offer.characterId)}
                      >
                        {copy.confirm(offer.displayName, offer.price)}
                      </button>
                    )}
                    <button
                      className="forest-secondary"
                      disabled={busy || error !== null}
                      onClick={() => setSelectedId(null)}
                    >
                      {copy.change}
                    </button>
                    <Link className="forest-secondary" href="/carte">
                      {eggShop.continue}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
