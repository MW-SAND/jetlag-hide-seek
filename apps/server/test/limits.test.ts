import { MAX_BODY_BYTES, MAX_SHARE_BYTES } from "@jetlag/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRateLimiter } from "../src/ratelimit.ts";
import { Browser, startServer, type TestServer } from "./helpers.ts";

describe("rate limiter", () => {
    it("allows up to the limit per window and resets", () => {
        let t = 0;
        const limiter = createRateLimiter(() => t, {
            x: { limit: 3, windowMs: 1000 },
        });
        expect([1, 2, 3, 4].map(() => limiter.hit("x", "ip"))).toEqual([
            true,
            true,
            true,
            false,
        ]);
        expect(limiter.hit("x", "other-ip")).toBe(true);
        t = 1000;
        expect(limiter.hit("x", "ip")).toBe(true);
    });

    it("keeps memory bounded", () => {
        let t = 0;
        const limiter = createRateLimiter(() => t, {
            x: { limit: 1, windowMs: 1000 },
        });
        for (let i = 0; i < 25_000; i++) limiter.hit("x", `ip${i}`);
        expect(limiter.size()).toBeLessThanOrEqual(20_000);
        t = 5000;
        limiter.prune();
        expect(limiter.size()).toBe(0);
    });
});

describe("HTTP limits", () => {
    let srv: TestServer;
    beforeAll(async () => {
        srv = await startServer();
    });
    afterAll(() => srv.close());

    it("rate-limits game creation per client IP (X-Forwarded-For last hop)", async () => {
        const b = new Browser(srv.url);
        const statuses: number[] = [];
        for (let i = 0; i < 21; i++) {
            const r = await b.request(
                "POST",
                "/api/games",
                { displayName: `R${i}` },
                { "x-forwarded-for": "1.2.3.4, 9.9.9.9" },
            );
            statuses.push(r.status);
        }
        expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
        expect(statuses[20]).toBe(429);
        const other = await b.request(
            "POST",
            "/api/games",
            { displayName: "Other" },
            { "x-forwarded-for": "8.8.8.8" },
        );
        expect(other.status).toBe(201);
    });

    it("rejects oversized bodies with 413", async () => {
        const b = new Browser(srv.url);
        const big = "x".repeat(MAX_BODY_BYTES + 10);
        const res = await b.request("POST", "/api/shares", { data: big });
        expect(res.status).toBe(413);
        const share = await b.post("/api/shares", {
            data: "y".repeat(MAX_SHARE_BYTES + 1),
        });
        expect(share.status).toBe(413);
    });

    it("rejects malformed JSON and wrong content types", async () => {
        const b = new Browser(srv.url);
        const bad = await fetch(`${srv.url}/api/games`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-requested-with": "jetlag",
            },
            body: "{nope",
        });
        expect(bad.status).toBe(400);
        const text = await fetch(`${srv.url}/api/games`, {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "x-requested-with": "jetlag",
            },
            body: "{}",
        });
        expect(text.status).toBe(400);
        expect((await b.get("/api/games/by-code/!!")).status).toBe(400);
    });
});
