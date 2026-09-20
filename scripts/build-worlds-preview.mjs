/** Bundle the real art workbench for local-file QA when listening sockets are unavailable. */
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const esbuildDir = (await readdir("node_modules/.pnpm")).find((n) => n.startsWith("esbuild@"));
const { build } = await import(
  path.join(root, "node_modules/.pnpm", esbuildDir, "node_modules/esbuild/lib/main.js")
);
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {WorldScenesPreview} from './src/components/game/WorldScenesPreview'; createRoot(document.getElementById('root')).render(<WorldScenesPreview />);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "local-scene",
      setup(build) {
        // The inert map needs ordinary anchors in this standalone file, not Next's router.
        // Importing next/link here eagerly reads Next-only process.env variables in a browser.
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "preview" }));
        build.onLoad({ filter: /.*/, namespace: "preview" }, () => ({
          contents: `export default function PreviewLink({href, children, ...props}) {
            return <a {...props} href={href} onClick={event => event.preventDefault()}>{children}</a>;
          }`,
          loader: "jsx",
          resolveDir: root,
        }));
        build.onLoad({ filter: /ForestScene\.tsx$/ }, async ({ path: filename }) => ({
          contents: (await readFile(filename, "utf8")).replace(
            "import(/* webpackIgnore: true */ modulePath)",
            'import("' + path.join(root, "public/forest/world.js") + '")',
          ),
          loader: "tsx",
          resolveDir: path.dirname(filename),
        }));
      },
    },
  ],
});
const fonts = await readdir("src/app/fonts");
let css = "";
for (const font of fonts.filter((f) => f.endsWith(".woff2"))) {
  const family = /baloo/i.test(font) ? "Baloo 2" : "Nunito";
  css += `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${(await readFile("src/app/fonts/" + font)).toString("base64")}) format('woff2');}`;
}
css += await readFile("tokens.css", "utf8");
css += await readFile("src/app/forest.css", "utf8");
css += "body{margin:0}";
await mkdir("docs/playthroughs/teddy-worlds", { recursive: true });
await writeFile(
  "docs/playthroughs/teddy-worlds/preview.html",
  `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEDDy · atelier des mondes</title><style>${css}</style><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></html>`,
);
console.log("Standalone world workbench bundled from real components. No server, DB or gameplay.");
