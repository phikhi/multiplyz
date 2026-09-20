/** Execute the delivered HTML itself: a blank page is a failure, even if compilation succeeded.
 * jsdom checks startup and interactions, not WebGL pixels or browser layout.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => {
  if (error.type === "unhandled exception")
    errors.push(error.detail?.stack?.split("\n").slice(0, 3).join("\n") ?? error.message);
});
virtualConsole.on("error", (error) => errors.push(String(error)));
const dom = new JSDOM(await readFile("docs/playthroughs/teddy-worlds/preview.html", "utf8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  url: "file:///teddy-worlds/preview.html",
  beforeParse(window) {
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  },
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
try {
  await settle();
  const root = dom.window.document.getElementById("root");
  assert(root.querySelector("h1"), `Delivered preview is blank: ${errors.join("; ")}`);
  assert.equal(root.querySelectorAll("select").length, 3, "Missing preview controls");
  async function select(index, value) {
    const control = root.querySelectorAll("select")[index];
    control.value = value;
    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle();
  }
  const checked = [];
  for (const [value, passage, map] of [
    ["forest", "Le passage des lucioles", "La forêt des premiers pas"],
    ["ocean", "Le jardin des perles", "Océan scintillant"],
    ["magic", "Les jardins suspendus", "Royaume magique"],
    ["galaxy", "Le pont des constellations", "Galaxie lointaine"],
    ["candy", "La promenade des délices", "Pays des bonbons"],
    ["snow", "Les lanternes du grand blanc", "Vallée enneigée"],
    ["forest:4", "La clairière des lanternes", "Forêt enchantée"],
  ]) {
    await select(0, value);
    assert.equal(root.querySelector("h1")?.textContent, passage);
    await select(2, "10");
    assert(root.querySelector(".forest-story-panel p")?.textContent, "Missing ending narrative");
    await select(1, "map");
    assert.equal(root.querySelector("h1")?.textContent, map);
    assert.equal(root.querySelectorAll(".forest-map-nodes li").length, 11);
    const link = root.querySelector('.forest-map a[href="/jouer"]');
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    assert(click.defaultPrevented, "Standalone map must never navigate to the real game");
    await select(1, "adventure");
    await select(2, "0");
    assert.equal(root.querySelector("h1")?.textContent, passage);
    checked.push(value);
  }
  assert.deepEqual(errors, []);
  const report = {
    method:
      "Delivered HTML executed in jsdom, with matchMedia and ResizeObserver stubs. No WebGL pixel or browser layout validation.",
    startup: true,
    checked,
    mapNodes: 11,
    navigationPrevented: true,
    errors,
  };
  await writeFile(
    "docs/playthroughs/teddy-worlds/preview-startup-check.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  dom.window.close();
}
