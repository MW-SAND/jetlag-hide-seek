import { UNDO_WINDOW_MS } from "@jetlag/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Browser, startServer, type TestServer } from "./helpers.ts";

describe("full multiplayer game over the HTTP API", () => {
    let srv: TestServer;
    let host: Browser,
        seekerA: Browser,
        seekerB: Browser,
        hider2: Browser,
        outsider: Browser;
    let gameId = "";
    let roomCode = "";

    beforeAll(async () => {
        srv = await startServer();
        host = new Browser(srv.url);
        seekerA = new Browser(srv.url);
        seekerB = new Browser(srv.url);
        hider2 = new Browser(srv.url);
        outsider = new Browser(srv.url);
    });
    afterAll(() => srv.close());

    it("creates a game with the creator as host", async () => {
        const res = await host.post("/api/games", {
            displayName: "  Host ",
            role: "hider",
        });
        expect(res.status).toBe(201);
        expect(res.json.roomCode).toMatch(
            /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
        );
        expect(res.json.phase).toBe("setup");
        gameId = res.json.gameId;
        roomCode = res.json.roomCode;
        expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);

        const state = await host.get(`/api/games/${gameId}/state`);
        expect(state.json.you).toMatchObject({ role: "hider", isHost: true });
        expect(state.json.players.map((p: any) => p.displayName)).toEqual([
            "Host",
        ]);
        expect(state.json).toHaveProperty("hiderLocation", null);
    });

    it("rejects invalid input", async () => {
        expect(
            (
                await outsider.post("/api/games", {
                    displayName: "",
                    role: "hider",
                })
            ).status,
        ).toBe(400);
        expect(
            (await outsider.post("/api/games", { displayName: "x".repeat(21) }))
                .status,
        ).toBe(400);
        const noCsrf = await outsider.request(
            "POST",
            "/api/games",
            { displayName: "a" },
            { "x-requested-with": "" },
        );
        expect(noCsrf.status).toBe(403);
    });

    it("lets players join case-insensitively and enforces unique names", async () => {
        const a = await seekerA.post("/api/games/join", {
            roomCode: roomCode.toLowerCase(),
            displayName: "Alice",
        });
        expect(a.status).toBe(200);
        expect(a.json.alreadyJoined).toBe(false);
        expect(
            (
                await seekerB.post("/api/games/join", {
                    roomCode,
                    displayName: "Alice",
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await seekerB.post("/api/games/join", {
                    roomCode,
                    displayName: "Bob",
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await hider2.post("/api/games/join", {
                    roomCode,
                    displayName: "Hide2",
                    role: "hider",
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await outsider.post("/api/games/join", {
                    roomCode: "ZZZZZZ",
                    displayName: "X",
                })
            ).status,
        ).toBe(404);
    });

    it("hides the game from outsiders", async () => {
        expect((await outsider.get(`/api/games/${gameId}/state`)).status).toBe(
            403,
        );
        expect(
            (await outsider.get(`/api/games/by-code/${roomCode}`)).status,
        ).toBe(403);
        expect(
            (
                await outsider.get(
                    `/api/games/00000000-0000-0000-0000-000000000000/state`,
                )
            ).status,
        ).toBe(404);
    });

    it("only lets the host change settings and geo", async () => {
        expect(
            (
                await seekerA.patch(`/api/games/${gameId}/settings`, {
                    hidingRadius: 1,
                })
            ).status,
        ).toBe(403);
        const ok = await host.patch(`/api/games/${gameId}/settings`, {
            hidingRadius: 0.5,
            hidingRadiusUnits: "miles",
            displayHidingZonesOptions: ["[railway=station]"],
        });
        expect(ok.status).toBe(200);

        const before = (await host.get(`/api/games/${gameId}/state`)).json
            .geoVersions;
        expect(
            (
                await seekerA.put(`/api/games/${gameId}/geo/polyGeoJSON`, {
                    value: {},
                })
            ).status,
        ).toBe(403);
        const poly = { type: "FeatureCollection", features: [] };
        expect(
            (
                await host.put(`/api/games/${gameId}/geo/polyGeoJSON`, {
                    value: poly,
                })
            ).status,
        ).toBe(200);
        expect(
            (await host.put(`/api/games/${gameId}/geo/nope`, { value: 1 }))
                .status,
        ).toBe(400);
        const after = (await host.get(`/api/games/${gameId}/state`)).json;
        expect(after.geoVersions.polyGeoJSON).toBeGreaterThan(
            before.polyGeoJSON,
        );
        expect(after.geoVersions.mapGeoLocation).toBe(before.mapGeoLocation);
        expect(after.game.settings).toEqual({
            hidingRadius: 0.5,
            hidingRadiusUnits: "miles",
            displayHidingZonesOptions: ["[railway=station]"],
        });
        expect(
            (await seekerA.get(`/api/games/${gameId}/geo/polyGeoJSON`)).json
                .value,
        ).toEqual(poly);
        expect(
            (await seekerA.get(`/api/games/${gameId}/geo`)).json,
        ).toMatchObject({ polyGeoJSON: poly, mapGeoLocation: null });
    });

    it("rejects questions before the game starts", async () => {
        const res = await seekerA.post(`/api/games/${gameId}/questions`, {
            type: "radius",
            data: { lat: 1 },
        });
        expect(res.status).toBe(409);
    });

    it("only the host can start; join after start is blocked but rejoin works", async () => {
        expect((await seekerA.post(`/api/games/${gameId}/start`)).status).toBe(
            403,
        );
        expect((await host.post(`/api/games/${gameId}/start`)).status).toBe(
            200,
        );
        expect((await host.post(`/api/games/${gameId}/start`)).status).toBe(
            409,
        );
        expect(
            (
                await outsider.post("/api/games/join", {
                    roomCode,
                    displayName: "Late",
                })
            ).status,
        ).toBe(409);
        const again = await seekerA.post("/api/games/join", {
            roomCode,
            displayName: "Whatever",
        });
        expect(again.json).toMatchObject({
            alreadyJoined: true,
            phase: "playing",
        });
        const rejoin = await seekerA.get(`/api/games/by-code/${roomCode}`);
        expect(rejoin.json).toMatchObject({ gameId, phase: "playing" });
    });

    let questionId = "";
    let answerId = "";

    it("seekers ask, hiders answer, with undo window", async () => {
        expect(
            (
                await seekerA.post(`/api/games/${gameId}/questions`, {
                    type: "radius",
                    data: { drag: true },
                })
            ).status,
        ).toBe(400);
        expect(
            (
                await host.post(`/api/games/${gameId}/questions`, {
                    type: "radius",
                    data: {},
                })
            ).status,
        ).toBe(403);

        const asked = await seekerA.post(`/api/games/${gameId}/questions`, {
            type: "radius",
            data: {
                lat: 1,
                lng: 2,
                radius: 5,
                within: true,
                drag: false,
                collapsed: true,
                _dbId: "x",
            },
        });
        expect(asked.status).toBe(200);
        questionId = asked.json.id;

        const q = (await seekerB.get(`/api/games/${gameId}/state`)).json
            .questions[0];
        expect(q).toMatchObject({
            id: questionId,
            order: 1,
            type: "radius",
            answer: null,
            veto: null,
        });
        expect(q.data).toEqual({ lat: 1, lng: 2, radius: 5, within: true });

        expect(
            (
                await seekerA.post(`/api/questions/${questionId}/answer`, {
                    data: { confirmed: true },
                })
            ).status,
        ).toBe(403);
        const answered = await host.post(
            `/api/questions/${questionId}/answer`,
            { data: { confirmed: true } },
        );
        expect(answered.status).toBe(200);
        answerId = answered.json.id;
        expect(
            (
                await hider2.post(`/api/questions/${questionId}/answer`, {
                    data: {},
                })
            ).status,
        ).toBe(409);
        expect(
            (await hider2.post(`/api/questions/${questionId}/veto`, {})).status,
        ).toBe(409);

        expect((await hider2.del(`/api/answers/${answerId}`)).status).toBe(403);
        srv.clock.advance(UNDO_WINDOW_MS - 1000);
        expect((await host.del(`/api/answers/${answerId}`)).status).toBe(200);

        const again = await host.post(`/api/questions/${questionId}/answer`, {
            data: { confirmed: false },
        });
        answerId = again.json.id;
        srv.clock.advance(UNDO_WINDOW_MS);
        const late = await host.del(`/api/answers/${answerId}`);
        expect(late.status).toBe(403);
        expect(late.json.error.message).toBe("Undo window has expired");
    });

    it("supports vetoes", async () => {
        const asked = await seekerB.post(`/api/games/${gameId}/questions`, {
            type: "thermometer",
            data: { warmer: true },
        });
        const vetoed = await hider2.post(
            `/api/questions/${asked.json.id}/veto`,
            { reason: "  nope " },
        );
        expect(vetoed.status).toBe(200);
        const state = (await seekerB.get(`/api/games/${gameId}/state`)).json;
        expect(state.questions[1].order).toBe(2);
        expect(state.questions[1].veto).toMatchObject({ reason: "nope" });
        expect((await host.del(`/api/vetoes/${vetoed.json.id}`)).status).toBe(
            403,
        );
        expect((await hider2.del(`/api/vetoes/${vetoed.json.id}`)).status).toBe(
            200,
        );
        expect(
            (await seekerB.get(`/api/games/${gameId}/state`)).json.questions[1]
                .veto,
        ).toBeNull();
    });

    it("keeps the hider location away from seekers", async () => {
        expect(
            (
                await seekerA.put(`/api/games/${gameId}/hider-location`, {
                    lat: 1,
                    lng: 1,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await hider2.put(`/api/games/${gameId}/hider-location`, {
                    lat: 52.1,
                    lng: 5.1,
                })
            ).status,
        ).toBe(200);
        expect(
            (await host.get(`/api/games/${gameId}/state`)).json.hiderLocation,
        ).toMatchObject({ lat: 52.1, lng: 5.1 });
        const seekerState = await seekerA.get(`/api/games/${gameId}/state`);
        expect(seekerState.json).not.toHaveProperty("hiderLocation");
        expect(seekerState.text).not.toContain("52.1");
    });

    it("keeps questions when the asker leaves and transfers host", async () => {
        expect((await seekerA.post(`/api/games/${gameId}/leave`)).status).toBe(
            204,
        );
        expect((await seekerA.get(`/api/games/${gameId}/state`)).status).toBe(
            403,
        );
        const state = (await host.get(`/api/games/${gameId}/state`)).json;
        expect(state.questions[0].askedBy).toBeNull();

        expect((await host.post(`/api/games/${gameId}/leave`)).status).toBe(
            204,
        );
        const after = (await seekerB.get(`/api/games/${gameId}/state`)).json;
        expect(after.players.map((p: any) => p.displayName)).toEqual([
            "Bob",
            "Hide2",
        ]);
        expect(after.you.isHost).toBe(true);
        expect(after.questions[0].answer.answeredBy).toBeNull();
    });

    it("ends the game and freezes it", async () => {
        expect((await hider2.post(`/api/games/${gameId}/end`)).status).toBe(
            403,
        );
        expect((await seekerB.post(`/api/games/${gameId}/end`)).status).toBe(
            200,
        );
        expect(
            (
                await seekerB.post(`/api/games/${gameId}/questions`, {
                    type: "radius",
                    data: {},
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await seekerB.patch(`/api/games/${gameId}/settings`, {
                    hidingRadius: 2,
                })
            ).status,
        ).toBe(409);
        expect(
            (await seekerB.get(`/api/games/${gameId}/state`)).json.game.phase,
        ).toBe("ended");
    });

    it("deletes the game when the last player leaves", async () => {
        await seekerB.post(`/api/games/${gameId}/leave`);
        await hider2.post(`/api/games/${gameId}/leave`);
        expect(
            (await hider2.get(`/api/games/by-code/${roomCode}`)).status,
        ).toBe(404);
    });

    it("expires games after the TTL", async () => {
        const created = await host.post("/api/games", { displayName: "Temp" });
        srv.clock.advance(31 * 24 * 60 * 60 * 1000);
        expect(
            (await host.get(`/api/games/${created.json.gameId}/state`)).status,
        ).toBe(404);
        srv.app.runCleanup();
        const row = srv.app.db
            .prepare("SELECT COUNT(*) AS n FROM games")
            .get() as { n: number };
        expect(row.n).toBe(0);
    });

    it("stores and serves shares", async () => {
        const created = await outsider.post("/api/shares", {
            data: "abc-DEF_123",
        });
        expect(created.json.id).toMatch(/^[0-9A-Za-z]{10}$/);
        expect(
            (await new Browser(srv.url).get(`/api/shares/${created.json.id}`))
                .json,
        ).toEqual({ data: "abc-DEF_123" });
        expect((await outsider.get("/api/shares/doesnotexist")).status).toBe(
            404,
        );
        expect((await outsider.get("/api/shares/..%2f")).status).toBe(404);
    });

    it("answers unknown routes with JSON 404 and wrong methods with 405", async () => {
        expect((await outsider.get("/api/nope")).json.error.code).toBe(
            "not_found",
        );
        expect((await outsider.request("DELETE", "/api/games")).status).toBe(
            405,
        );
    });

    it("reports health", async () => {
        const res = await outsider.get("/healthz");
        expect(res.json).toMatchObject({ ok: true });
    });
});
