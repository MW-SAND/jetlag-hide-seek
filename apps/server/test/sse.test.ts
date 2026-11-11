import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Browser, startServer, type TestServer } from "./helpers.ts";

/** Minimal SSE reader on top of fetch streaming. */
async function openEvents(browser: Browser, gameId: string) {
    const controller = new AbortController();
    const res = await fetch(`${browser.base}/api/games/${gameId}/events`, {
        headers: { cookie: browser.cookie },
        signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const raw: string[] = [];
    let ended = false;

    const pump = (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                raw.push(decoder.decode(value));
            }
        } catch {
            /* aborted */
        }
        ended = true;
    })();

    const events = () =>
        buffer
            .split("\n\n")
            .filter((block) => block.includes("event:"))
            .map((block) => {
                const event = /event: (\w+)/.exec(block)![1];
                const data = /data: (.*)/.exec(block)?.[1];
                return { event, data: data ? JSON.parse(data) : null };
            });

    const waitFor = async (predicate: () => boolean, ms = 3000) => {
        const start = Date.now();
        while (!predicate()) {
            if (Date.now() - start > ms)
                throw new Error("timeout waiting for SSE; got: " + buffer);
            await new Promise((r) => setTimeout(r, 10));
        }
    };

    return {
        res,
        events,
        raw: () => buffer,
        isEnded: () => ended,
        waitFor,
        close: async () => {
            controller.abort();
            await pump;
        },
    };
}

describe("server-sent events", () => {
    let srv: TestServer;
    let host: Browser, seeker: Browser;
    let gameId = "";

    beforeAll(async () => {
        srv = await startServer({ heartbeatMs: 50 });
        host = new Browser(srv.url);
        seeker = new Browser(srv.url);
        const created = await host.post("/api/games", { displayName: "Host" });
        gameId = created.json.gameId;
        await seeker.post("/api/games/join", {
            roomCode: created.json.roomCode,
            displayName: "S",
        });
    });
    afterAll(() => srv.close());

    it("rejects non-players", async () => {
        const res = await fetch(`${srv.url}/api/games/${gameId}/events`);
        expect(res.status).toBe(403);
    });

    it("sends the current state on connect, changes, heartbeats and removal", async () => {
        const stream = await openEvents(seeker, gameId);
        expect(stream.res.headers.get("content-type")).toContain(
            "text/event-stream",
        );
        expect(stream.res.headers.get("x-accel-buffering")).toBe("no");

        await stream.waitFor(() => stream.events().length >= 1);
        const first = stream.events()[0];
        expect(first.event).toBe("state");
        expect(Object.keys(first.data).sort()).toEqual([
            "geoVersions",
            "version",
        ]);

        await host.put(`/api/games/${gameId}/geo/mapGeoLocation`, {
            value: { a: 1 },
        });
        await stream.waitFor(() => stream.events().length >= 2);
        const second = stream.events()[1].data;
        expect(second.version).toBeGreaterThan(first.data.version);
        expect(second.geoVersions.mapGeoLocation).toBe(second.version);

        await stream.waitFor(() => stream.raw().includes(": ping"));

        await seeker.post(`/api/games/${gameId}/leave`);
        await stream.waitFor(() =>
            stream.events().some((e) => e.event === "removed"),
        );
        await stream.waitFor(() => stream.isEnded());
        await stream.close();
    });

    it("caps streams per client", async () => {
        const streams: Awaited<ReturnType<typeof openEvents>>[] = [];
        for (let i = 0; i < 6; i++)
            streams.push(await openEvents(host, gameId));
        await streams[0].waitFor(() => streams[0].isEnded());
        expect(srv.app.hub.count()).toBe(5);
        await Promise.all(streams.map((s) => s.close()));
    });
});
