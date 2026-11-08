// Starts the production server bundle against a throw-away data dir for e2e
// tests. Requires `pnpm build` first.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetlag-e2e-"));
fs.writeFileSync(path.join(dataDir, ".jetlag-volume"), "");

const server = path.join(root, "apps/server/dist/server.mjs");
const staticDir = path.join(root, "apps/web/dist");
for (const required of [server, path.join(staticDir, "index.html")]) {
    if (!fs.existsSync(required)) {
        console.error(`Missing ${required}. Run \`pnpm build\` first.`);
        process.exit(1);
    }
}

const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", server],
    {
        stdio: "inherit",
        env: {
            ...process.env,
            PORT: process.env.E2E_PORT ?? "8090",
            HOST: "127.0.0.1",
            DATA_DIR: dataDir,
            STATIC_DIR: staticDir,
            COOKIE_SECURE: "false",
            TRUST_PROXY: "false",
            LOG_LEVEL: "warn",
        },
    },
);

const stop = () => {
    child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(code ?? 0);
});
