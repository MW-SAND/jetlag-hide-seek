import fs from "node:fs";

import { build } from "esbuild";

const pkg = JSON.parse(
    fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

await build({
    entryPoints: ["src/main.ts"],
    outfile: "dist/server.mjs",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    banner: {
        js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
    define: {
        "process.env.APP_VERSION": JSON.stringify(
            process.env.APP_VERSION || pkg.version,
        ),
    },
    logLevel: "info",
});
