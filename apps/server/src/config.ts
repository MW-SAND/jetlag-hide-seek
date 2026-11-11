import path from "node:path";

export interface Config {
    port: number;
    host: string;
    dataDir: string;
    staticDir: string | null;
    requireDataMarker: boolean;
    trustProxy: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
    gameTtlMs: number;
    shareTtlMs: number;
    cookieSecure: boolean;
    heartbeatMs: number;
    version: string;
    overpassUpstreams: string[];
    overpassCacheBytes: number;
    overpassCacheTtlMs: number;
}

const bool = (value: string | undefined, fallback: boolean) => {
    if (value === undefined || value === "") return fallback;
    return !["0", "false", "no", "off"].includes(value.toLowerCase());
};

const num = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value !== undefined && value !== "" && Number.isFinite(n)
        ? n
        : fallback;
};

const DAY = 24 * 60 * 60 * 1000;

export const DATA_MARKER = ".jetlag-volume";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const level = (env.LOG_LEVEL ?? "info").toLowerCase();
    return {
        port: num(env.PORT, 8080),
        host: env.HOST || "0.0.0.0",
        dataDir: path.resolve(env.DATA_DIR || "/data"),
        staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null,
        requireDataMarker: bool(env.REQUIRE_DATA_MARKER, true),
        trustProxy: bool(env.TRUST_PROXY, true),
        logLevel: (["debug", "info", "warn", "error"].includes(level)
            ? level
            : "info") as Config["logLevel"],
        gameTtlMs: num(env.GAME_TTL_DAYS, 30) * DAY,
        shareTtlMs: num(env.SHARE_TTL_DAYS, 180) * DAY,
        cookieSecure: bool(env.COOKIE_SECURE, true),
        heartbeatMs: num(env.SSE_HEARTBEAT_MS, 25_000),
        version: env.APP_VERSION || process.env.APP_VERSION || "dev",
        overpassUpstreams: (
            env.OVERPASS_UPSTREAMS || DEFAULT_OVERPASS_UPSTREAMS.join(",")
        )
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        overpassCacheBytes: num(env.OVERPASS_CACHE_MB, 200) * 1024 * 1024,
        overpassCacheTtlMs: num(env.OVERPASS_CACHE_DAYS, 7) * DAY,
    };
}

export const DEFAULT_OVERPASS_UPSTREAMS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
];
