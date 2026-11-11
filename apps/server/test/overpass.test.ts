import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { startServer, type TestServer } from "./helpers.ts";

const A = "https://a.example/api/interpreter";
const B = "https://b.example/api/interpreter";

/** Fake Overpass servers: answers per host, records every call. */
function fakeOverpass(
    behaviour: Record<string, (query: string) => Response | Promise<Response>>,
) {
    const calls: { host: string; query: string }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
        const host = new URL(String(url)).host;
        const query = new URLSearchParams(String(init?.body)).get("data") ?? "";
        calls.push({ host, query });
        return behaviour[host](query);
    }) as typeof fetch;
    return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

let srv: TestServer | null = null;
afterEach(async () => {
    await srv?.close();
    srv = null;
});

const get = (query: string, headers: Record<string, string> = {}) =>
    fetch(`${srv!.url}/api/overpass?data=${encodeURIComponent(query)}`, {
        headers,
    });

describe("Overpass caching proxy", () => {
    it("fetches once, then serves from the gzip disk cache", async () => {
        const fake = fakeOverpass({
            "a.example": (q) => json({ elements: [{ id: 1, q }] }),
        });
        srv = await startServer(
            { overpassUpstreams: [A] },
            { overpassFetch: fake.fetchImpl },
        );

        const first = await get("node(1);out;");
        expect(first.status).toBe(200);
        expect(first.headers.get("x-cache")).toBe("MISS");
        expect(await first.json()).toEqual({
            elements: [{ id: 1, q: "node(1);out;" }],
        });

        const second = await get("node(1);out;");
        expect(second.headers.get("x-cache")).toBe("HIT");
        expect(await second.json()).toEqual({
            elements: [{ id: 1, q: "node(1);out;" }],
        });
        expect(fake.calls).toHaveLength(1);

        const files = fs.readdirSync(
            path.join(srv.dataDir, "cache", "overpass"),
        );
        expect(files).toHaveLength(1);
        const stored = zlib.gunzipSync(
            fs.readFileSync(
                path.join(srv.dataDir, "cache", "overpass", files[0]),
            ),
        );
        expect(JSON.parse(stored.toString())).toEqual({
            elements: [{ id: 1, q: "node(1);out;" }],
        });
    });

    it("coalesces identical concurrent queries", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const fake = fakeOverpass({
            "a.example": async () => {
                await gate;
                return json({ elements: [] });
            },
        });
        srv = await startServer(
            { overpassUpstreams: [A] },
            { overpassFetch: fake.fetchImpl },
        );
        const pending = Array.from({ length: 5 }, () => get("same"));
        await new Promise((r) => setTimeout(r, 50));
        release();
        const responses = await Promise.all(pending);
        expect(responses.map((r) => r.status)).toEqual([
            200, 200, 200, 200, 200,
        ]);
        expect(fake.calls).toHaveLength(1);
    });

    it("fails over to the next mirror on 429", async () => {
        const fake = fakeOverpass({
            "a.example": () => new Response("busy", { status: 429 }),
            "b.example": () => json({ elements: ["from-b"] }),
        });
        srv = await startServer(
            { overpassUpstreams: [A, B] },
            { overpassFetch: fake.fetchImpl },
        );
        const res = await get("q");
        expect(await res.json()).toEqual({ elements: ["from-b"] });
        expect(fake.calls.map((c) => c.host)).toEqual([
            "a.example",
            "b.example",
        ]);
    });

    it("returns 502 when every mirror fails, without caching", async () => {
        const fake = fakeOverpass({
            "a.example": () => new Response("down", { status: 503 }),
        });
        srv = await startServer(
            { overpassUpstreams: [A] },
            { overpassFetch: fake.fetchImpl },
        );
        const res = await get("q");
        expect(res.status).toBe(502);
        expect(((await res.json()) as any).error.message).toMatch(/503/);
        expect(
            fs.readdirSync(path.join(srv.dataDir, "cache", "overpass")),
        ).toEqual([]);
    });

    it("passes Overpass timeouts through but never caches them", async () => {
        let n = 0;
        const fake = fakeOverpass({
            "a.example": () =>
                n++ === 0
                    ? json({
                          elements: [],
                          remark: 'runtime error: Query timed out in "query"',
                      })
                    : json({ elements: ["ok"] }),
        });
        srv = await startServer(
            { overpassUpstreams: [A] },
            { overpassFetch: fake.fetchImpl },
        );
        const first = await get("slow");
        expect(first.headers.get("x-cache")).toBe("BYPASS");
        expect(((await first.json()) as any).remark).toMatch(/timed out/);
        const second = await get("slow");
        expect(await second.json()).toEqual({ elements: ["ok"] });
        expect(fake.calls).toHaveLength(2);
    });

    it("accepts long queries via POST and shares the cache with GET", async () => {
        const fake = fakeOverpass({
            "a.example": () => json({ elements: [42] }),
        });
        srv = await startServer(
            { overpassUpstreams: [A] },
            { overpassFetch: fake.fetchImpl },
        );
        const query = "poly:" + "1.0 2.0 ".repeat(2000);
        const noCsrf = await fetch(`${srv.url}/api/overpass`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "data=" + encodeURIComponent(query),
        });
        expect(noCsrf.status).toBe(403);
        const posted = await fetch(`${srv.url}/api/overpass`, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "x-requested-with": "jetlag",
            },
            body: "data=" + encodeURIComponent(query),
        });
        expect(await posted.json()).toEqual({ elements: [42] });
        expect(fake.calls[0].query).toBe(query);
        const again = await fetch(`${srv.url}/api/overpass`, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "x-requested-with": "jetlag",
            },
            body: "data=" + encodeURIComponent(query),
        });
        expect(again.headers.get("x-cache")).toBe("HIT");
    });

    it("rejects empty queries and serves plain JSON to clients without gzip", async () => {
        const fake = fakeOverpass({
            "a.example": () => json({ elements: [] }),
        });
        srv = await startServer(
            { overpassUpstreams: [A] },
            { overpassFetch: fake.fetchImpl },
        );
        expect((await fetch(`${srv.url}/api/overpass`)).status).toBe(400);
        await get("plain");
        const res = await get("plain", { "accept-encoding": "identity" });
        expect(res.headers.get("content-encoding")).toBeNull();
        expect(await res.json()).toEqual({ elements: [] });
    });

    it("evicts least-recently-used entries over the size cap and survives restarts", async () => {
        const big = (q: string) =>
            json({
                elements: Array.from(
                    { length: 3000 },
                    (_, i) => `${q}-${i}-${Math.random()}`,
                ),
            });
        const fake = fakeOverpass({ "a.example": big });
        srv = await startServer(
            { overpassUpstreams: [A], overpassCacheBytes: 60 * 1024 },
            { overpassFetch: fake.fetchImpl },
        );
        for (const q of ["q1", "q2", "q3", "q4", "q5"])
            await (await get(q)).arrayBuffer();
        const stats = srv.app.overpass.stats();
        expect(stats.bytes).toBeLessThanOrEqual(60 * 1024);
        expect(stats.entries).toBeLessThan(5);

        // The newest entry is kept and still served after a restart.
        const dataDir = srv.dataDir;
        await srv.close();
        srv = await startServer(
            { dataDir, overpassUpstreams: [A], overpassCacheBytes: 60 * 1024 },
            { overpassFetch: fake.fetchImpl },
        );
        const calls = fake.calls.length;
        expect((await get("q5")).headers.get("x-cache")).toBe("HIT");
        expect(fake.calls.length).toBe(calls);
    });

    it("refreshes entries older than the TTL", async () => {
        const fake = fakeOverpass({
            "a.example": () => json({ elements: [fake.calls.length] }),
        });
        srv = await startServer(
            { overpassUpstreams: [A], overpassCacheTtlMs: 60_000 },
            { overpassFetch: fake.fetchImpl },
        );
        await (await get("ttl")).arrayBuffer();
        srv.clock.advance(61_000);
        const res = await get("ttl");
        expect(res.headers.get("x-cache")).toBe("MISS");
        expect(fake.calls).toHaveLength(2);
    });
});
