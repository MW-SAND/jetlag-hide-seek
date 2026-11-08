import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CSP } from "../src/static.ts";
import { startServer, type TestServer } from "./helpers.ts";

describe("static file serving", () => {
    let srv: TestServer;
    let root: string;

    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "jetlag-static-"));
        fs.mkdirSync(path.join(root, "assets"));
        const js = "console.log('hello world');".repeat(50);
        fs.writeFileSync(
            path.join(root, "index.html"),
            "<!doctype html><title>JL</title>",
        );
        fs.writeFileSync(path.join(root, "assets", "app-abc123.js"), js);
        fs.writeFileSync(
            path.join(root, "assets", "app-abc123.js.br"),
            zlib.brotliCompressSync(js),
        );
        fs.writeFileSync(
            path.join(root, "assets", "app-abc123.js.gz"),
            zlib.gzipSync(js),
        );
        fs.writeFileSync(path.join(root, "coastline50.geojson"), "{}");
        fs.writeFileSync(path.join(root, "sw.js"), "//sw");
        srv = await startServer({ staticDir: root });
    });
    afterAll(() => srv.close());

    it("serves precompressed brotli with immutable caching", async () => {
        const res = await fetch(`${srv.url}/assets/app-abc123.js`, {
            headers: { "accept-encoding": "gzip, br" },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-encoding")).toBe("br");
        expect(res.headers.get("cache-control")).toBe(
            "public, max-age=31536000, immutable",
        );
        expect(res.headers.get("vary")).toBe("Accept-Encoding");
        expect(res.headers.get("content-type")).toContain("text/javascript");
        expect(await res.text()).toContain("hello world");
    });

    it("falls back to gzip, then identity", async () => {
        const gz = await fetch(`${srv.url}/assets/app-abc123.js`, {
            headers: { "accept-encoding": "gzip" },
        });
        expect(gz.headers.get("content-encoding")).toBe("gzip");
        const plain = await fetch(`${srv.url}/assets/app-abc123.js`, {
            headers: { "accept-encoding": "identity" },
        });
        expect(plain.headers.get("content-encoding")).toBeNull();
    });

    it("serves index.html with no-cache, CSP and security headers; SPA fallback", async () => {
        for (const url of ["/", "/some/client/route"]) {
            const res = await fetch(srv.url + url);
            expect(res.status).toBe(200);
            expect(res.headers.get("cache-control")).toBe("no-cache");
            expect(res.headers.get("content-security-policy")).toBe(CSP);
            expect(res.headers.get("x-content-type-options")).toBe("nosniff");
            expect(await res.text()).toContain("<title>JL</title>");
        }
        expect(
            (await fetch(`${srv.url}/sw.js`)).headers.get("cache-control"),
        ).toBe("no-cache");
    });

    it("404s for missing assets instead of serving index.html", async () => {
        expect((await fetch(`${srv.url}/assets/missing.js`)).status).toBe(404);
        expect((await fetch(`${srv.url}/missing.png`)).status).toBe(404);
    });

    it("blocks path traversal", async () => {
        for (const url of [
            "/..%2f..%2fpackage.json",
            "/%2e%2e/%2e%2e/package.json",
            "/assets/..%5c..%5cpackage.json",
        ]) {
            const res = await fetch(srv.url + url);
            expect(res.status).toBe(404);
        }
    });

    it("uses the geojson MIME type and supports ETag revalidation + HEAD", async () => {
        const res = await fetch(`${srv.url}/coastline50.geojson`);
        expect(res.headers.get("content-type")).toContain(
            "application/geo+json",
        );
        const etag = res.headers.get("etag")!;
        const again = await fetch(`${srv.url}/coastline50.geojson`, {
            headers: { "if-none-match": etag },
        });
        expect(again.status).toBe(304);
        const head = await fetch(`${srv.url}/coastline50.geojson`, {
            method: "HEAD",
        });
        expect(head.status).toBe(200);
        expect(head.headers.get("content-length")).toBe("2");
    });
});
