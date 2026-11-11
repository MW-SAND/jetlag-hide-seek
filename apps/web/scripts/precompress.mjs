// Writes .br and .gz siblings for compressible build output, so the server
// never spends CPU on compression (the Jetson has none to spare).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(process.argv[2] ?? "dist");
const COMPRESSIBLE =
    /\.(js|mjs|css|html|json|webmanifest|geojson|svg|txt|xml|wasm)$/;
const MIN_BYTES = 1024;

let files = 0;
let before = 0;
let after = 0;

const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (COMPRESSIBLE.test(entry.name)) compress(full);
    }
};

const compress = (file) => {
    const data = fs.readFileSync(file);
    if (data.length < MIN_BYTES) return;
    const br = zlib.brotliCompressSync(data, {
        params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
        },
    });
    const gz = zlib.gzipSync(data, { level: 9 });
    if (br.length < data.length) fs.writeFileSync(file + ".br", br);
    if (gz.length < data.length) fs.writeFileSync(file + ".gz", gz);
    files++;
    before += data.length;
    after += br.length;
};

walk(root);
console.log(
    `precompressed ${files} files: ${(before / 1024).toFixed(0)} KiB → ${(after / 1024).toFixed(0)} KiB (brotli)`,
);
