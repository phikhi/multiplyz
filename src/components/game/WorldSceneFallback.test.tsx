import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ForestScene } from "./ForestScene";
import { worldSceneStatus } from "@/strings/world-scenes";
import { contrastRatio, resolveTokenColor } from "./scaffolds/test-support/tokens-css";

it.each([
  "https://outside.test/x.png",
  "/generated/world/../../private.png",
  "/generated/placeholder://world/0",
])("never fetches an unsafe fallback: %s", async (background) => {
  const { container } = render(
    <ForestScene
      phase="question"
      completed={3}
      total={6}
      paused
      reduced
      theme={{
        slug: "ocean",
        label: "Océan",
        accent: "#123456",
        background,
        tiles: null,
        teddy: null,
      }}
    />,
  );
  expect(container.querySelectorAll("img")).toHaveLength(0);
  // jsdom has no dynamic scene module/WebGL. Its failure must leave the page usable.
  expect(await screen.findByText(worldSceneStatus.fallback)).toBeInTheDocument();
});
it("keeps a validated generated backdrop usable and tolerates a missing file", () => {
  const { container } = render(
    <ForestScene
      phase="arrival"
      completed={0}
      total={10}
      paused={false}
      reduced
      theme={{
        slug: "snow",
        label: "Neige",
        accent: "#123456",
        background: "/generated/world/8/background.png",
        tiles: null,
        teddy: null,
      }}
    />,
  );
  const img = container.querySelector("img")!;
  expect(img.src).toContain("/generated/world/8/background.png");
  fireEvent.error(img);
  expect(container.querySelector("img")).toBeNull();
});
it.each(["light", "dark"] as const)(
  "keeps titles, node symbols and buttons legible on fixed opaque panels: %s",
  (mode) => {
    for (const [text, background] of [
      ["--forest-cream", "--forest-deep"],
      ["--forest-mint", "--forest-deep"],
      ["--forest-gold", "--forest-deep"],
      ["--forest-ink", "--forest-cream"],
      ["--forest-ink", "--forest-gold"],
      ["--forest-ink", "--forest-mint"],
    ]) {
      expect(
        contrastRatio(resolveTokenColor(mode, text), resolveTokenColor(mode, background)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  },
);
