import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Browser, startServer, type TestServer } from "./helpers.ts";

/** Deterministic PRNG so failures are reproducible. */
const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
};

describe("privacy: hider location never reaches seekers", () => {
    let srv: TestServer;
    beforeAll(async () => {
        srv = await startServer();
    });
    afterAll(() => srv.close());

    it("survives a randomized sequence of actions", async () => {
        const random = rng(42);
        const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];

        const host = new Browser(srv.url);
        const created = await host.post("/api/games", {
            displayName: "H",
            role: "hider",
        });
        const { gameId, roomCode } = created.json;
        const hider = new Browser(srv.url);
        const seekers = [new Browser(srv.url), new Browser(srv.url)];
        await hider.post("/api/games/join", {
            roomCode,
            displayName: "H2",
            role: "hider",
        });
        await seekers[0].post("/api/games/join", {
            roomCode,
            displayName: "S1",
        });
        await seekers[1].post("/api/games/join", {
            roomCode,
            displayName: "S2",
        });
        await host.post(`/api/games/${gameId}/start`);

        const bodies: string[] = [];
        const secretLats = new Set<string>();
        const questionIds: string[] = [];

        for (let i = 0; i < 200; i++) {
            const action = Math.floor(random() * 6);
            if (action === 0) {
                const lat = (10 + random() * 50).toFixed(6);
                secretLats.add(lat);
                await pick([host, hider]).put(
                    `/api/games/${gameId}/hider-location`,
                    {
                        lat: Number(lat),
                        lng: 4.123456,
                    },
                );
            } else if (action === 1) {
                const r = await pick(seekers).post(
                    `/api/games/${gameId}/questions`,
                    {
                        type: "radius",
                        data: {
                            lat: 1,
                            lng: 2,
                            radius: Math.floor(random() * 10),
                        },
                    },
                );
                if (r.json?.id) questionIds.push(r.json.id);
            } else if (action === 2 && questionIds.length) {
                await pick([host, hider]).post(
                    `/api/questions/${pick(questionIds)}/answer`,
                    {
                        data: { confirmed: random() > 0.5 },
                    },
                );
            } else if (action === 3 && questionIds.length) {
                await pick([host, hider]).post(
                    `/api/questions/${pick(questionIds)}/veto`,
                    {},
                );
            } else {
                const seeker = pick(seekers);
                for (const url of [
                    `/api/games/${gameId}/state`,
                    `/api/games/${gameId}/geo`,
                    `/api/games/by-code/${roomCode}`,
                ]) {
                    const res = await seeker.get(url);
                    bodies.push(res.text);
                    if (url.endsWith("/state"))
                        expect(res.json).not.toHaveProperty("hiderLocation");
                }
            }
        }

        expect(bodies.length).toBeGreaterThan(20);
        for (const body of bodies) {
            for (const lat of secretLats) expect(body).not.toContain(lat);
            expect(body).not.toContain("4.123456");
        }

        // No response may ever contain a client token or its hash.
        const tokens = [host, hider, ...seekers].map(
            (b) => b.cookie.split("=")[1],
        );
        const hashes = (
            srv.app.db.prepare("SELECT token_hash FROM clients").all() as {
                token_hash: string;
            }[]
        ).map((r) => r.token_hash);
        const hostState = (await host.get(`/api/games/${gameId}/state`)).text;
        for (const secret of [...tokens, ...hashes]) {
            expect(hostState).not.toContain(secret);
            for (const body of bodies) expect(body).not.toContain(secret);
        }
        expect(hostState).toContain("hiderLocation");
    });
});
