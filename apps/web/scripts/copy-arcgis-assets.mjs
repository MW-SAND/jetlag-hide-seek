// Copies the only ArcGIS runtime asset the geo engine needs (the projection
// engine WASM used by the geodesic operators) into public/, so it is served
// from our own origin instead of js.arcgis.com.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
    path.join(webDir, "../../packages/geo/package.json"),
);
const corePkg = require.resolve("@arcgis/core/package.json");
const coreDir = path.dirname(corePkg);

const FILES = ["esri/geometry/support/pe-wasm.wasm"];

for (const rel of FILES) {
    const from = path.join(coreDir, "assets", rel);
    const to = path.join(webDir, "public", "arcgis", rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}
console.log(`copied ${FILES.length} ArcGIS asset(s) to public/arcgis`);
