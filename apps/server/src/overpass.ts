/**
 * Caching proxy for the Overpass API.
 *
 * Every player in a game asks Overpass the same questions (area boundary,
 * nearby stations, zoos…). Public Overpass servers rate-limit per IP and
 * phones behind carrier NAT share IPs, so 429s are common. This proxy:
 * - caches responses gzip-compressed on disk (USB drive), LRU size-capped;
 * - coalesces identical in-flight queries;
 * - limits concurrent upstream requests (Overpass allows ~2 slots per IP);
 * - fails over between mirrors and backs off on 429/5xx.
 * Responses are streamed, so memory stays flat even for multi-MB results.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

import type { Logger } from "./log.ts";

export interface OverpassOptions {
    cacheDir: string;
    upstreams: string[];
    ttlMs: number;
    maxBytes: number;
    maxQueryBytes?: number;
    concurrency?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    fetchImpl?: typeof fetch;
    log: Logger;
    now?: () => number;
}

interface Entry {
    size: number;
    /** Download time (file mtime, never touched afterwards). */
    downloadedAt: number;
    /** In-memory LRU clock; starts at the download time after a restart. */
    lastUsed: number;
}

const USER_AGENT =
    "jetlag-hide-seek (+https://github.com/MW-SAND/jetlag-hide-seek)";
/** Overpass reports query timeouts as HTTP 200 with a "remark"; never cache those. */
const RUNTIME_ERROR = /"remark"\s*:\s*"runtime (error|remark)/;

export class UpstreamError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export function createOverpassProxy(options: OverpassOptions) {
    const {
        cacheDir,
        upstreams,
        ttlMs,
        maxBytes,
        maxQueryBytes = 200_000,
        concurrency = 2,
        timeoutMs = 120_000,
        retryDelayMs = 2_000,
        log,
    } = options;
    const fetchImpl = options.fetchImpl ?? fetch;
    const now = options.now ?? Date.now;

    fs.mkdirSync(cacheDir, { recursive: true });
    const index = new Map<string, Entry>();
    let totalBytes = 0;
    for (const name of fs.readdirSync(cacheDir)) {
        const full = path.join(cacheDir, name);
        if (name.endsWith(".tmp")) {
            fs.rmSync(full, { force: true });
            continue;
        }
        if (!name.endsWith(".json.gz")) continue;
        const stat = fs.statSync(full);
        index.set(name.slice(0, -".json.gz".length), {
            size: stat.size,
            downloadedAt: stat.mtimeMs,
            lastUsed: stat.mtimeMs,
        });
        totalBytes += stat.size;
    }

    const fileFor = (key: string) => path.join(cacheDir, `${key}.json.gz`);

    const evict = () => {
        if (totalBytes <= maxBytes) return;
        const entries = [...index.entries()].sort(
            (a, b) => a[1].lastUsed - b[1].lastUsed,
        );
        for (const [key, entry] of entries) {
            if (totalBytes <= maxBytes * 0.9) break;
            fs.rmSync(fileFor(key), { force: true });
            index.delete(key);
            totalBytes -= entry.size;
        }
    };

    // ─── Upstream with concurrency limit ─────────────────────
    let active = 0;
    const waiting: (() => void)[] = [];
    const acquire = async () => {
        if (active < concurrency) {
            active++;
            return;
        }
        await new Promise<void>((resolve) => waiting.push(resolve));
        active++;
    };
    const release = () => {
        active--;
        waiting.shift()?.();
    };

    async function fetchUpstream(
        query: string,
    ): Promise<{ res: Response; done: () => void }> {
        let lastError: UpstreamError = new UpstreamError(
            502,
            "No Overpass server configured",
        );
        for (let round = 0; round < 2; round++) {
            for (const url of upstreams) {
                const controller = new AbortController();
                // The timeout also covers streaming the body; `done` clears it.
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const res = await fetchImpl(url, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "User-Agent": USER_AGENT,
                            Accept: "application/json",
                        },
                        body: "data=" + encodeURIComponent(query),
                        signal: controller.signal,
                    });
                    if (res.ok && res.body)
                        return { res, done: () => clearTimeout(timer) };
                    clearTimeout(timer);
                    await res.body?.cancel().catch(() => {});
                    lastError = new UpstreamError(
                        res.status === 400 ? 400 : 502,
                        `Overpass ${new URL(url).host} answered ${res.status}`,
                    );
                    if (res.status === 400) throw lastError; // bad query: no point retrying
                    log.warn("overpass upstream failed", {
                        host: new URL(url).host,
                        status: res.status,
                    });
                } catch (error) {
                    clearTimeout(timer);
                    if (error instanceof UpstreamError && error.status === 400)
                        throw error;
                    if (!(error instanceof UpstreamError)) {
                        lastError = new UpstreamError(
                            504,
                            `Overpass ${new URL(url).host} unreachable`,
                        );
                        log.warn("overpass upstream error", {
                            host: new URL(url).host,
                            err: String(error),
                        });
                    }
                }
            }
            if (round === 0)
                await new Promise((r) => setTimeout(r, retryDelayMs));
        }
        throw lastError;
    }

    /** Download into the cache; resolves when the file is ready (or rejects). */
    async function populate(
        key: string,
        query: string,
    ): Promise<"cached" | Buffer> {
        await acquire();
        try {
            const { res, done } = await fetchUpstream(query);
            const tmp = `${fileFor(key)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
            let head = "";
            let tail = "";
            let bytes = 0;
            const inspect = new Transform({
                transform(chunk: Buffer, _enc, cb) {
                    bytes += chunk.length;
                    if (head.length < 4096)
                        head += chunk.toString(
                            "utf8",
                            0,
                            Math.min(chunk.length, 4096),
                        );
                    tail = (tail + chunk.toString("utf8")).slice(-4096);
                    cb(null, chunk);
                },
            });
            try {
                await pipeline(
                    Readable.fromWeb(res.body as any),
                    inspect,
                    zlib.createGzip({ level: 6 }),
                    fs.createWriteStream(tmp),
                );
            } catch (error) {
                fs.rmSync(tmp, { force: true });
                throw new UpstreamError(
                    504,
                    `Overpass download failed: ${(error as Error).message}`,
                );
            } finally {
                done();
            }
            if (RUNTIME_ERROR.test(head) || RUNTIME_ERROR.test(tail)) {
                // Don't cache Overpass timeouts / memory errors: hand the body back once.
                const body = zlib.gunzipSync(fs.readFileSync(tmp));
                fs.rmSync(tmp, { force: true });
                log.warn("overpass runtime error not cached", { bytes });
                return body;
            }
            fs.renameSync(tmp, fileFor(key));
            const stat = fs.statSync(fileFor(key));
            const previous = index.get(key);
            if (previous) totalBytes -= previous.size;
            index.set(key, {
                size: stat.size,
                downloadedAt: now(),
                lastUsed: now(),
            });
            totalBytes += stat.size;
            evict();
            return "cached";
        } finally {
            release();
        }
    }

    const inflight = new Map<string, Promise<"cached" | Buffer>>();

    function sendCached(
        req: IncomingMessage,
        res: ServerResponse,
        key: string,
        hit: boolean,
    ) {
        const file = fileFor(key);
        const stat = fs.statSync(file);
        const entry = index.get(key);
        if (entry) entry.lastUsed = now();

        const gzipOk = /\bgzip\b/.test(
            String(req.headers["accept-encoding"] ?? ""),
        );
        const headers: Record<string, string | number> = {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=86400",
            "X-Cache": hit ? "HIT" : "MISS",
            Vary: "Accept-Encoding",
        };
        if (gzipOk) {
            headers["Content-Encoding"] = "gzip";
            headers["Content-Length"] = stat.size;
        }
        res.writeHead(200, headers);
        if (req.method === "HEAD") return void res.end();
        const source = fs.createReadStream(file);
        (gzipOk ? source : source.pipe(zlib.createGunzip()))
            .on("error", () => res.destroy())
            .pipe(res);
    }

    function sendError(res: ServerResponse, status: number, message: string) {
        const body = JSON.stringify({
            error: { code: status === 400 ? "invalid" : "internal", message },
        });
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
    }

    async function handle(
        req: IncomingMessage,
        res: ServerResponse,
        query: string,
    ) {
        if (!query || Buffer.byteLength(query) > maxQueryBytes) {
            return sendError(res, 400, "Missing or oversized Overpass query");
        }
        const key = crypto.createHash("sha256").update(query).digest("hex");
        const entry = index.get(key);
        if (
            entry &&
            now() - entry.downloadedAt < ttlMs &&
            fs.existsSync(fileFor(key))
        ) {
            return sendCached(req, res, key, true);
        }

        let job = inflight.get(key);
        if (!job) {
            job = populate(key, query).finally(() => inflight.delete(key));
            inflight.set(key, job);
        }
        try {
            const result = await job;
            if (result === "cached") return sendCached(req, res, key, false);
            res.writeHead(200, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Cache": "BYPASS",
            });
            res.end(result);
        } catch (error) {
            const status = error instanceof UpstreamError ? error.status : 502;
            sendError(
                res,
                status,
                (error as Error).message || "Overpass request failed",
            );
        }
    }

    return {
        handle,
        stats: () => ({
            entries: index.size,
            bytes: totalBytes,
            inflight: inflight.size,
        }),
    };
}

export type OverpassProxy = ReturnType<typeof createOverpassProxy>;
