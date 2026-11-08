import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import {
    answerQuestionRequest,
    CLIENT_COOKIE,
    createGameRequest,
    createQuestionRequest,
    createShareRequest,
    geoFieldSchema,
    joinGameRequest,
    MAX_BODY_BYTES,
    MAX_SHARE_BYTES,
    putGeoRequest,
    putHiderLocationRequest,
    roomCodeSchema,
    updateSettingsRequest,
    vetoQuestionRequest,
} from "@jetlag/shared";
import type { z } from "zod";

import { type Config, DATA_MARKER } from "./config.ts";
import { closeDatabase, openDatabase } from "./db.ts";
import { AppError, fail } from "./errors.ts";
import { createLogger, type Logger } from "./log.ts";
import { createRateLimiter, type RateBucket } from "./ratelimit.ts";
import { createService } from "./service.ts";
import { createSseHub } from "./sse.ts";
import { createStaticHandler } from "./static.ts";

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "jetlag";

const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const SECURITY_HEADERS: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
};

export interface AppOptions {
    config: Config;
    now?: () => number;
    logger?: Logger;
}

interface Ctx {
    req: IncomingMessage;
    res: ServerResponse;
    ip: string;
    tokenHash: string;
    params: Record<string, string>;
    body: unknown;
}

type Handler = (ctx: Ctx) => unknown;

interface Route {
    method: string;
    pattern: RegExp;
    keys: string[];
    rate?: RateBucket;
    handler: Handler;
}

const hashToken = (token: string) =>
    crypto.createHash("sha256").update(token).digest("hex");

const parseCookies = (header: string | undefined) => {
    const out: Record<string, string> = {};
    for (const part of (header ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
};

const parse = <T extends z.ZodTypeAny>(
    schema: T,
    value: unknown,
): z.output<T> => {
    const result = schema.safeParse(value);
    if (!result.success) {
        const issue = result.error.issues[0];
        const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
        fail("invalid", `${where}${issue?.message ?? "Invalid request"}`);
    }
    return result.data;
};

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > limit) {
            reject(new AppError("too_large", "Request body too large"));
            req.resume();
            return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                reject(new AppError("too_large", "Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

export function createApp({ config, now = Date.now, logger }: AppOptions) {
    const log = logger ?? createLogger(config.logLevel);

    if (
        config.requireDataMarker &&
        !fs.existsSync(path.join(config.dataDir, DATA_MARKER))
    ) {
        throw new Error(
            `Data marker ${path.join(config.dataDir, DATA_MARKER)} not found. ` +
                "Is the data volume mounted? Refusing to start on an empty directory.",
        );
    }

    const db = openDatabase(config.dataDir);
    const hub = createSseHub(config.heartbeatMs);
    const service = createService(db, {
        now,
        gameTtlMs: config.gameTtlMs,
        shareTtlMs: config.shareTtlMs,
        onChange: (gameId, event) => hub.broadcast(gameId, event),
        onPlayerRemoved: (gameId, playerId) =>
            hub.removePlayer(gameId, playerId),
        onGameDeleted: (gameId) => hub.removeGame(gameId),
    });
    const limiter = createRateLimiter(now);
    const serveStatic = config.staticDir
        ? createStaticHandler(config.staticDir)
        : null;

    const clientId = (ctx: Ctx) => service.findClient(ctx.tokenHash);
    const ensureClientId = (ctx: Ctx) => service.ensureClient(ctx.tokenHash);
    const geoField = (ctx: Ctx) => parse(geoFieldSchema, ctx.params.field);

    // ─── Routes ──────────────────────────────────────────────
    const routes: Route[] = [];
    const route = (
        method: string,
        pathPattern: string,
        handler: Handler,
        rate?: RateBucket,
    ) => {
        const keys: string[] = [];
        const pattern = new RegExp(
            "^" +
                pathPattern.replace(/:(\w+)/g, (_, key) => {
                    keys.push(key);
                    return "([^/]+)";
                }) +
                "$",
        );
        routes.push({ method, pattern, keys, handler, rate });
    };

    route(
        "POST",
        "/api/games",
        (ctx) =>
            service.createGame(
                ensureClientId(ctx),
                parse(createGameRequest, ctx.body),
            ),
        "createGame",
    );
    route(
        "POST",
        "/api/games/join",
        (ctx) =>
            service.joinGame(
                ensureClientId(ctx),
                parse(joinGameRequest, ctx.body),
            ),
        "joinGame",
    );
    route("GET", "/api/games/by-code/:code", (ctx) =>
        service.rejoin(clientId(ctx), parse(roomCodeSchema, ctx.params.code)),
    );
    route("GET", "/api/games/:gameId/state", (ctx) =>
        service.getState(clientId(ctx), ctx.params.gameId),
    );
    route("GET", "/api/games/:gameId/geo", (ctx) =>
        service.getGeo(clientId(ctx), ctx.params.gameId),
    );
    route("GET", "/api/games/:gameId/geo/:field", (ctx) =>
        service.getGeoField(clientId(ctx), ctx.params.gameId, geoField(ctx)),
    );
    route("GET", "/api/games/:gameId/events", (ctx) => {
        const id = clientId(ctx);
        const info = service.subscribeInfo(id, ctx.params.gameId);
        hub.open(ctx.res, {
            gameId: ctx.params.gameId,
            clientId: id!,
            ...info,
        });
        return STREAMING;
    });
    route("POST", "/api/games/:gameId/leave", (ctx) => {
        service.leave(clientId(ctx), ctx.params.gameId);
        return NO_CONTENT;
    });
    route("POST", "/api/games/:gameId/start", (ctx) =>
        service.start(clientId(ctx), ctx.params.gameId),
    );
    route("POST", "/api/games/:gameId/end", (ctx) =>
        service.end(clientId(ctx), ctx.params.gameId),
    );
    route("PATCH", "/api/games/:gameId/settings", (ctx) =>
        service.updateSettings(
            clientId(ctx),
            ctx.params.gameId,
            parse(updateSettingsRequest, ctx.body),
        ),
    );
    route("PUT", "/api/games/:gameId/geo/:field", (ctx) =>
        service.putGeo(
            clientId(ctx),
            ctx.params.gameId,
            geoField(ctx),
            parse(putGeoRequest, ctx.body).value,
        ),
    );
    route("PUT", "/api/games/:gameId/hider-location", (ctx) =>
        service.putHiderLocation(
            clientId(ctx),
            ctx.params.gameId,
            parse(putHiderLocationRequest, ctx.body),
        ),
    );
    route("POST", "/api/games/:gameId/questions", (ctx) =>
        service.askQuestion(
            clientId(ctx),
            ctx.params.gameId,
            parse(createQuestionRequest, ctx.body),
        ),
    );
    route("POST", "/api/questions/:questionId/answer", (ctx) =>
        service.answer(
            clientId(ctx),
            ctx.params.questionId,
            parse(answerQuestionRequest, ctx.body).data,
        ),
    );
    route("DELETE", "/api/answers/:answerId", (ctx) =>
        service.undoAnswer(clientId(ctx), ctx.params.answerId),
    );
    route("POST", "/api/questions/:questionId/veto", (ctx) =>
        service.veto(
            clientId(ctx),
            ctx.params.questionId,
            parse(vetoQuestionRequest, ctx.body ?? {}).reason,
        ),
    );
    route("DELETE", "/api/vetoes/:vetoId", (ctx) =>
        service.unveto(clientId(ctx), ctx.params.vetoId),
    );
    route(
        "POST",
        "/api/shares",
        (ctx) => {
            const { data } = parse(createShareRequest, ctx.body);
            if (Buffer.byteLength(data) > MAX_SHARE_BYTES)
                fail("too_large", "Share is too large");
            return service.createShare(data);
        },
        "share",
    );
    route("GET", "/api/shares/:id", (ctx) => {
        if (!/^[0-9A-Za-z]{1,32}$/.test(ctx.params.id))
            fail("not_found", "Share not found");
        return service.getShare(ctx.params.id);
    });

    // ─── Request handling ────────────────────────────────────
    const inFlight = new Set<Promise<void>>();
    let shuttingDown = false;

    const clientIp = (req: IncomingMessage) => {
        if (config.trustProxy) {
            const xff = String(req.headers["x-forwarded-for"] ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            if (xff.length) return xff[xff.length - 1];
        }
        return req.socket.remoteAddress ?? "unknown";
    };

    const sendJson = (res: ServerResponse, status: number, body: unknown) => {
        const text = JSON.stringify(body);
        res.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Length": Buffer.byteLength(text),
        });
        res.end(text);
    };

    async function handleApi(
        req: IncomingMessage,
        res: ServerResponse,
        pathname: string,
    ) {
        const cookies = parseCookies(req.headers.cookie);
        let token = cookies[CLIENT_COOKIE];
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
            token = crypto.randomBytes(32).toString("base64url");
            res.setHeader(
                "Set-Cookie",
                `${CLIENT_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${config.cookieSecure ? "; Secure" : ""}`,
            );
        }

        const method = req.method ?? "GET";
        let matched: Route | undefined;
        let params: Record<string, string> = {};
        let pathMatched = false;
        for (const r of routes) {
            const m = r.pattern.exec(pathname);
            if (!m) continue;
            pathMatched = true;
            if (r.method !== method) continue;
            matched = r;
            params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
            break;
        }
        if (!matched) {
            if (pathMatched)
                return sendJson(res, 405, {
                    error: { code: "invalid", message: "Method not allowed" },
                });
            return sendJson(res, 404, {
                error: { code: "not_found", message: "Not found" },
            });
        }

        const ip = clientIp(req);
        const isMutation = method !== "GET" && method !== "HEAD";
        if (isMutation && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
            fail("forbidden", "Missing X-Requested-With header");
        }
        if (matched.rate && !limiter.hit(matched.rate, ip))
            fail("rate_limited", "Too many requests, slow down");
        if (isMutation && !limiter.hit("mutation", ip))
            fail("rate_limited", "Too many requests, slow down");

        let body: unknown = undefined;
        if (isMutation) {
            const raw = await readBody(req, MAX_BODY_BYTES);
            if (raw.length > 0) {
                const type = String(req.headers["content-type"] ?? "");
                if (!type.startsWith("application/json"))
                    fail("invalid", "Content-Type must be application/json");
                try {
                    body = JSON.parse(raw.toString("utf8"));
                } catch {
                    fail("invalid", "Invalid JSON body");
                }
            }
        }

        const result = matched.handler({
            req,
            res,
            ip,
            tokenHash: hashToken(token),
            params,
            body,
        });
        if (result === STREAMING) return;
        if (result === NO_CONTENT) {
            res.writeHead(204, { "Cache-Control": "no-store" });
            res.end();
            return;
        }
        sendJson(
            res,
            method === "POST" && pathname === "/api/games" ? 201 : 200,
            result,
        );
    }

    async function handle(req: IncomingMessage, res: ServerResponse) {
        for (const [k, v] of Object.entries(SECURITY_HEADERS))
            res.setHeader(k, v);
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname;
        try {
            if (pathname === "/healthz") {
                try {
                    service.health();
                    return sendJson(res, 200, {
                        ok: true,
                        version: config.version,
                    });
                } catch {
                    return sendJson(res, 503, {
                        ok: false,
                        version: config.version,
                    });
                }
            }
            if (pathname.startsWith("/api/")) {
                if (shuttingDown) {
                    res.setHeader("Connection", "close");
                    return sendJson(res, 503, {
                        error: {
                            code: "internal",
                            message: "Server is restarting",
                        },
                    });
                }
                return await handleApi(req, res, pathname);
            }
            if (serveStatic && serveStatic(req, res, pathname)) return;
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
        } catch (error) {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            if (error instanceof AppError) {
                return sendJson(res, error.status, {
                    error: { code: error.code, message: error.message },
                });
            }
            log.error("unhandled error", {
                path: pathname,
                err: String((error as Error)?.stack ?? error),
            });
            sendJson(res, 500, {
                error: { code: "internal", message: "Internal server error" },
            });
        }
    }

    const server = http.createServer((req, res) => {
        const p = handle(req, res).finally(() => inFlight.delete(p));
        inFlight.add(p);
    });
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 70_000;
    server.requestTimeout = 60_000;

    const runCleanup = () => {
        try {
            const result = service.cleanup();
            if (result.expiredGames) log.info("cleanup", result);
        } catch (error) {
            log.error("cleanup failed", { err: String(error) });
        }
    };
    const firstCleanup = setTimeout(runCleanup, 10_000);
    const cleanupTimer = setInterval(runCleanup, 60 * 60 * 1000);
    firstCleanup.unref();
    cleanupTimer.unref();

    let closed: Promise<void> | null = null;
    function close(timeoutMs = 10_000): Promise<void> {
        if (closed) return closed;
        shuttingDown = true;
        clearTimeout(firstCleanup);
        clearInterval(cleanupTimer);
        closed = (async () => {
            const serverClosed = new Promise<void>((resolve) =>
                server.close(() => resolve()),
            );
            hub.closeAll();
            server.closeIdleConnections();
            await Promise.race([
                Promise.allSettled([...inFlight]),
                new Promise((resolve) => setTimeout(resolve, timeoutMs)),
            ]);
            server.closeAllConnections();
            await serverClosed;
            closeDatabase(db);
        })();
        return closed;
    }

    return { server, close, service, hub, db, limiter, runCleanup };
}

const STREAMING = Symbol("streaming");
const NO_CONTENT = Symbol("no-content");

export type App = ReturnType<typeof createApp>;
