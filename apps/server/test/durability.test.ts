import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { DB_FILE, MIGRATIONS, openDatabase, userVersion } from "../src/db.ts";
import { createLogger } from "../src/log.ts";
import { Browser, startServer, tempDataDir } from "./helpers.ts";

const SERVER_DIR = path.resolve(import.meta.dirname, "..");

describe("database durability", () => {
    it("migrates an empty database to the latest version, idempotently", () => {
        const dir = tempDataDir();
        const db = openDatabase(dir);
        expect(userVersion(db)).toBe(MIGRATIONS.length);
        db.close();
        const again = openDatabase(dir);
        expect(userVersion(again)).toBe(MIGRATIONS.length);
        const mode = again.prepare("PRAGMA journal_mode").get() as {
            journal_mode: string;
        };
        expect(mode.journal_mode).toBe("wal");
        again.close();
    });

    it("keeps the schema compatible with old sqlite3 (no STRICT / generated columns)", () => {
        const ddl = MIGRATIONS.join("\n");
        expect(ddl).not.toMatch(/\bSTRICT\b/i);
        expect(ddl).not.toMatch(/GENERATED\s+ALWAYS/i);
        expect(ddl).not.toMatch(/\bRETURNING\b/i);
        expect(ddl).not.toMatch(/\bjson_\w+\(/i);
        expect(ddl).not.toMatch(/unixepoch\(/i);
    });

    it("refuses to start when the data marker is missing", () => {
        const dir = tempDataDir(false);
        const config = {
            ...loadConfig({}),
            dataDir: dir,
            requireDataMarker: true,
        };
        expect(() =>
            createApp({ config, logger: createLogger("error", true) }),
        ).toThrow(/marker/);
        expect(fs.existsSync(path.join(dir, DB_FILE))).toBe(false);
    });

    it("exits non-zero from the entrypoint when the marker is missing", async () => {
        const dir = tempDataDir(false);
        const code = await new Promise<number | null>((resolve) => {
            const child = spawn(process.execPath, ["src/main.ts"], {
                cwd: SERVER_DIR,
                env: {
                    ...process.env,
                    DATA_DIR: dir,
                    PORT: "0",
                    LOG_LEVEL: "error",
                },
                stdio: "ignore",
            });
            child.on("exit", resolve);
        });
        expect(code).toBe(1);
    });

    it("checkpoints the WAL on graceful close", async () => {
        const srv = await startServer();
        const b = new Browser(srv.url);
        for (let i = 0; i < 20; i++)
            await b.post("/api/games", { displayName: `P${i}` });
        await srv.close();
        const wal = path.join(srv.dataDir, DB_FILE + "-wal");
        expect(!fs.existsSync(wal) || fs.statSync(wal).size === 0).toBe(true);
    });

    it("survives being killed mid-write", async () => {
        const dir = tempDataDir();
        const child = spawn(process.execPath, ["src/main.ts"], {
            cwd: SERVER_DIR,
            env: {
                ...process.env,
                DATA_DIR: dir,
                PORT: "18931",
                HOST: "127.0.0.1",
                LOG_LEVEL: "error",
                COOKIE_SECURE: "false",
            },
            stdio: "ignore",
        });
        try {
            const b = new Browser("http://127.0.0.1:18931");
            const start = Date.now();
            for (;;) {
                try {
                    await b.get("/healthz");
                    break;
                } catch {
                    if (Date.now() - start > 10_000)
                        throw new Error("server did not start");
                    await new Promise((r) => setTimeout(r, 100));
                }
            }
            let written = 0;
            let stop = false;
            const created = await b.post("/api/games", {
                displayName: "Killer",
            });
            const gameId = created.json.gameId;
            const blob = {
                type: "FeatureCollection",
                features: Array.from({ length: 200 }, (_, i) => ({ i })),
            };
            const writer = async () => {
                while (!stop) {
                    const r = await b
                        .put(`/api/games/${gameId}/geo/polyGeoJSON`, {
                            value: { ...blob, n: written },
                        })
                        .catch(() => null);
                    if (!r) break;
                    if (r.status === 200) written++;
                }
            };
            const writers = [writer(), writer(), writer()];
            while (written < 30) await new Promise((r) => setTimeout(r, 5));
            child.kill("SIGKILL");
            stop = true;
            await Promise.all(writers);
            expect(written).toBeGreaterThanOrEqual(30);
        } finally {
            if (child.exitCode === null && child.signalCode === null) {
                const exited = new Promise((r) => child.once("exit", r));
                child.kill("SIGKILL");
                await exited;
            }
        }

        const db = new DatabaseSync(path.join(dir, DB_FILE));
        const check = db.prepare("PRAGMA integrity_check").get() as {
            integrity_check: string;
        };
        expect(check.integrity_check).toBe("ok");
        const fk = db.prepare("PRAGMA foreign_key_check").all();
        expect(fk).toEqual([]);
        db.close();
    });
});
