import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".geojson": "application/geo+json; charset=utf-8",
    ".topojson": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
};

const NO_CACHE = new Set([
    "/index.html",
    "/sw.js",
    "/registerSW.js",
    "/manifest.webmanifest",
]);

/**
 * Content-Security-Policy for the HTML document. External hosts: map tiles
 * (Esri, OpenStreetMap, Thunderforest), the direct-Overpass last-resort
 * fallback and the Photon geocoder. ArcGIS WASM is served from our origin.
 */
export const CSP = [
    "default-src 'self'",
    "img-src 'self' data: blob: https://server.arcgisonline.com https://*.arcgisonline.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tile.thunderforest.com https://*.thunderforest.com",
    "connect-src 'self' https://overpass-api.de https://photon.komoot.io https://server.arcgisonline.com https://tile.openstreetmap.org https://tile.thunderforest.com",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "font-src 'self' data:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join("; ");

interface Resolved {
    file: string;
    stat: fs.Stats;
}

export function createStaticHandler(root: string) {
    const rootResolved = path.resolve(root);

    const resolve = (urlPath: string): Resolved | null => {
        let decoded: string;
        try {
            decoded = decodeURIComponent(urlPath);
        } catch {
            return null;
        }
        if (decoded.includes("\0")) return null;
        const file = path.resolve(
            rootResolved,
            "." + path.posix.normalize("/" + decoded),
        );
        if (file !== rootResolved && !file.startsWith(rootResolved + path.sep))
            return null;
        try {
            const stat = fs.statSync(file);
            return stat.isFile() ? { file, stat } : null;
        } catch {
            return null;
        }
    };

    const variant = (file: string, ext: string) => {
        try {
            const stat = fs.statSync(file + ext);
            return stat.isFile() ? stat : null;
        } catch {
            return null;
        }
    };

    return function serve(
        req: IncomingMessage,
        res: ServerResponse,
        urlPath: string,
    ): boolean {
        if (req.method !== "GET" && req.method !== "HEAD") return false;

        let target = resolve(urlPath === "/" ? "/index.html" : urlPath);
        let logicalPath = urlPath === "/" ? "/index.html" : urlPath;
        if (!target) {
            // SPA fallback only for "page-like" paths (no file extension).
            if (path.posix.extname(urlPath) || urlPath.startsWith("/assets/")) {
                res.writeHead(404, {
                    "Content-Type": "text/plain; charset=utf-8",
                });
                res.end("Not found");
                return true;
            }
            target = resolve("/index.html");
            logicalPath = "/index.html";
            if (!target) return false;
        }

        const ext = path.extname(target.file).toLowerCase();
        const headers: Record<string, string> = {
            "Content-Type": MIME[ext] ?? "application/octet-stream",
            Vary: "Accept-Encoding",
        };
        if (logicalPath.startsWith("/assets/")) {
            headers["Cache-Control"] = "public, max-age=31536000, immutable";
        } else if (NO_CACHE.has(logicalPath)) {
            headers["Cache-Control"] = "no-cache";
        } else {
            headers["Cache-Control"] = "public, max-age=3600";
        }
        if (ext === ".html") headers["Content-Security-Policy"] = CSP;

        const accept = String(req.headers["accept-encoding"] ?? "");
        let file = target.file;
        let stat = target.stat;
        let encoding = "";
        for (const [token, suffix] of [
            ["br", ".br"],
            ["gzip", ".gz"],
        ] as const) {
            if (!new RegExp(`\\b${token}\\b`).test(accept)) continue;
            const s = variant(target.file, suffix);
            if (s) {
                file = target.file + suffix;
                stat = s;
                encoding = token;
                break;
            }
        }
        if (encoding) headers["Content-Encoding"] = encoding;

        const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${encoding ? "-" + encoding : ""}"`;
        headers.ETag = etag;
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, headers);
            res.end();
            return true;
        }

        headers["Content-Length"] = String(stat.size);
        res.writeHead(200, headers);
        if (req.method === "HEAD") {
            res.end();
            return true;
        }
        fs.createReadStream(file)
            .on("error", () => res.destroy())
            .pipe(res);
        return true;
    };
}
