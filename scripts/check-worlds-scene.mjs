/** Deterministic geometry/lifecycle checks. Real Three geometry, fake GL; NOT pixel/performance QA. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import * as Three from "../public/forest/three.module.min.js";
import { buildBiome } from "../public/forest/biomes.js";
import { dressTeddy } from "../public/forest/teddy-accessories.js";
const source = (await readFile("public/forest/world.js", "utf8"))
  .replace(/^import .*$/gm, "")
  .replace("export function createTeddyForest", "function createTeddyForest");
const reports = [];
function instantiate(kind, worldIndex = 0) {
  const dom = new JSDOM(
    '<div id="root"><div class="tp-scene"><div class="tp-world"></div></div><div class="tp-loading"></div></div>',
    { pretendToBeVisual: true },
  );
  const { document } = dom.window;
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "createRadialGradient" || key === "createLinearGradient"
          ? () => ({ addColorStop() {} })
          : () => {},
    },
  );
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  const root = document.getElementById("root");
  const holder = root.querySelector(".tp-world");
  Object.defineProperties(holder, { clientWidth: { value: 1280 }, clientHeight: { value: 800 } });
  let loop,
    realScene,
    camera,
    disposed = false,
    cancelled = false;
  class Renderer {
    constructor() {
      this.domElement = document.createElement("canvas");
      this.shadowMap = {};
      this.info = { render: { calls: 0, triangles: 0 } };
    }
    setPixelRatio() {}
    getPixelRatio() {
      return 1;
    }
    setSize() {}
    setRenderTarget() {}
    render(s, c) {
      if (c.isPerspectiveCamera) {
        realScene = s;
        camera = c;
        s.updateMatrixWorld(true);
        c.updateMatrixWorld(true);
      }
    }
    dispose() {
      disposed = true;
    }
  }
  const contextVM = vm.createContext({
    THREE: { ...Three, WebGLRenderer: Renderer },
    buildBiome,
    dressTeddy,
    document,
    devicePixelRatio: 1,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (fn) => {
      loop = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      cancelled = true;
    },
    Math,
    console,
  });
  const create = vm.runInContext(source + "\ncreateTeddyForest;", contextVM);
  const handle = create(root, { kind, worldIndex });
  let stamp = 0;
  return {
    root,
    handle,
    tick() {
      loop((stamp += 16));
    },
    scene: () => realScene,
    camera: () => camera,
    done() {
      handle.dispose();
      assert(disposed && cancelled);
      assert.equal(holder.querySelectorAll("canvas").length, 0);
      dom.window.close();
    },
  };
}
function shapeSignature(scene, excluded = new Set()) {
  const parts = [];
  let meshes = 0,
    triangles = 0;
  scene.traverse((o) => {
    if (!o.geometry) return;
    for (let ancestor = o; ancestor; ancestor = ancestor.parent)
      if (excluded.has(ancestor.name)) return;
    const pos = o.geometry.attributes.position;
    assert(pos.array.every(Number.isFinite), "non-finite vertex");
    assert(o.position.toArray().every(Number.isFinite), "non-finite placement");
    parts.push([
      o.geometry.type,
      pos.count,
      o.position.toArray(),
      o.rotation.toArray().slice(0, 3),
      o.scale.toArray(),
    ]);
    triangles += (o.geometry.index?.count ?? pos.count) / 3;
    meshes++;
  });
  return {
    sha256: createHash("sha256").update(JSON.stringify(parts)).digest("hex"),
    meshes,
    triangles,
  };
}
for (const kind of ["forest", "ocean", "magic", "galaxy", "candy", "snow", "grove", "wonder"]) {
  const p = instantiate(kind);
  p.handle.setState({
    phase: "question",
    completed: 3,
    total: 6,
    paused: true,
    reduced: false,
    showFriend: false,
  });
  p.tick();
  assert.equal(
    p.root.querySelector(".tp-scene").dataset.travel,
    "0.500",
    kind + ": paused checkpoint must render at its saved location",
  );
  const cameraBefore = p.camera().position.toArray(),
    frames = p.root.querySelector(".tp-scene").dataset.frames;
  for (let i = 0; i < 20; i++) p.tick();
  assert.deepEqual(p.camera().position.toArray(), cameraBefore);
  assert.equal(p.root.querySelector(".tp-scene").dataset.frames, frames);
  const geometry = shapeSignature(p.scene());
  p.handle.setState({
    phase: "feedback",
    completed: 4,
    total: 6,
    paused: false,
    reduced: true,
    showFriend: false,
  });
  p.tick();
  assert.equal(p.root.querySelector(".tp-scene").dataset.travel, "0.667");
  const staticFrames = p.root.querySelector(".tp-scene").dataset.frames;
  p.tick();
  assert.equal(
    p.root.querySelector(".tp-scene").dataset.frames,
    staticFrames,
    "reduced motion must stop render work",
  );
  p.handle.setState({
    phase: "finale",
    completed: 6,
    total: 6,
    paused: false,
    reduced: true,
    showFriend: false,
  });
  p.tick();
  assert.equal(p.root.querySelector(".tp-scene").dataset.travel, "1.000");
  let bear;
  p.scene().traverse((o) => {
    if (o.userData.head) bear = o;
  });
  const accessory = bear.userData.accessory;
  assert.equal(accessory, ["grove", "wonder"].includes(kind) ? "forest" : kind);
  const outfit = new Three.Group();
  outfit.add(bear.getObjectByName("teddy-outfit").clone());
  outfit.add(bear.getObjectByName("teddy-headwear").clone());
  const outfitGeometry = shapeSignature(outfit);
  // Compare the actual body/face geometry, not only the name of its outfit.
  const canonicalGeometry = shapeSignature(
    bear,
    new Set(["teddy-outfit", "teddy-headwear"]),
  ).sha256;
  const projected = new Three.Vector3(bear.position.x, 1.5, bear.position.z).project(p.camera());
  assert(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, "Teddy out of camera frame");
  p.handle.setState({
    phase: "question",
    completed: 0,
    total: 6,
    paused: false,
    reduced: false,
    showFriend: false,
  });
  p.tick();
  assert.equal(p.root.querySelector(".tp-scene").dataset.travel, "0.000");
  p.handle.setState({
    phase: "feedback",
    completed: 1,
    total: 6,
    paused: false,
    reduced: false,
    showFriend: false,
  });
  for (let i = 0; i < 180; i++) p.tick();
  assert.equal(p.root.querySelector(".tp-scene").dataset.travel, "0.167");
  p.done();
  const repeat = instantiate(kind);
  repeat.handle.setState({
    phase: "question",
    completed: 3,
    total: 6,
    paused: true,
    reduced: false,
    showFriend: false,
  });
  repeat.tick();
  assert.equal(
    shapeSignature(repeat.scene()).sha256,
    geometry.sha256,
    "non-deterministic construction",
  );
  repeat.done();
  reports.push({
    kind,
    accessory,
    outfitGeometry: outfitGeometry.sha256,
    canonicalGeometry,
    ...geometry,
    pausedResume: true,
    reducedMotion: true,
    completedAndRestarted: true,
    teddyInFinalFrame: true,
    deterministic: true,
    disposed: true,
  });
}
assert.equal(
  new Set(reports.slice(0, 6).map((r) => r.outfitGeometry)).size,
  6,
  "accessories must differ in geometry, not just colour",
);
assert.equal(new Set(reports.map((r) => r.canonicalGeometry)).size, 1, "Teddy identity changed");
assert.equal(
  new Set(reports.slice(0, 7).map((r) => r.sha256)).size,
  7,
  "two worlds differ only in material",
);
const variant = instantiate("forest", 4);
variant.tick();
assert.notEqual(shapeSignature(variant.scene()).sha256, reports[0].sha256);
variant.done();
await mkdir("docs/playthroughs/teddy-worlds", { recursive: true });
await writeFile(
  "docs/playthroughs/teddy-worlds/scene-check.json",
  JSON.stringify(
    {
      method:
        "Real Three geometry and scene loop with fake WebGL renderer. No pixel, layout or performance claims.",
      worlds: reports,
      distinctGeometry: true,
      distinctSceneCount: 7,
      fallbackTemplate: "wonder reuses magic geometry",
      seededVariation: true,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    worlds: reports.length,
    geometry: "distinct and finite",
    pausedResume: true,
    reducedMotion: true,
    noPixelsRendered: true,
  }),
);
