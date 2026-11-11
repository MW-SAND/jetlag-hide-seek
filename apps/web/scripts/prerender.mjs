// Injects the server-rendered landing page into dist/index.html.
// Runs after `vite build` and `vite build --ssr src/entry-prerender.tsx`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ssrDir = path.join(webDir, "dist-ssr");
const indexPath = path.join(webDir, "dist", "index.html");

const entry = fs
    .readdirSync(ssrDir)
    .find((f) => /^entry-prerender\.m?js$/.test(f));
if (!entry) throw new Error(`prerender bundle not found in ${ssrDir}`);
const { render } = await import(pathToFileURL(path.join(ssrDir, entry)).href);

const markup = render();
let html = fs.readFileSync(indexPath, "utf8");
const placeholder = '<div id="root"></div>';
if (!html.includes(placeholder))
    throw new Error("root placeholder not found in index.html");
html = html.replace(placeholder, `<div id="root">${markup}</div>`);

// Preload the heading font so the prerendered title doesn't repaint late
// (the font is otherwise discovered only after the CSS is parsed).
const assetsDir = path.join(webDir, "dist", "assets");
const fonts = fs
    .readdirSync(assetsDir)
    .filter((f) => /^poppins-latin-700-normal-.*\.woff2$/.test(f));
const preloads = fonts
    .map(
        (f) =>
            `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin />`,
    )
    .join("");
html = html.replace("</title>", `</title>${preloads}`);

fs.writeFileSync(indexPath, html);
fs.rmSync(ssrDir, { recursive: true, force: true });
console.log(
    `prerendered landing page (${(markup.length / 1024).toFixed(1)} KiB of HTML, ${fonts.length} font preload)`,
);
