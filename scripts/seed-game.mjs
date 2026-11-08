#!/usr/bin/env node
// Fills a running server with a realistic game (players, questions, answers,
// veto, geo data) and leaves it in place. Used by CI before the backup
// compatibility test so the DB has WAL content to copy.
//   node scripts/seed-game.mjs [baseUrl]
const base = (process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/$/, "");

class Client {
    cookie = "";
    async req(method, path, body) {
        const res = await fetch(base + path, {
            method,
            headers: {
                "content-type": "application/json",
                "x-requested-with": "jetlag",
                ...(this.cookie ? { cookie: this.cookie } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const set = res.headers.get("set-cookie");
        if (set) this.cookie = set.split(";")[0];
        const text = await res.text();
        if (!res.ok)
            throw new Error(`${method} ${path} → ${res.status} ${text}`);
        return text ? JSON.parse(text) : null;
    }
}

const host = new Client();
const hider = new Client();
const { gameId, roomCode } = await host.req("POST", "/api/games", {
    displayName: "Seeker",
    role: "seeker",
});
await hider.req("POST", "/api/games/join", {
    roomCode,
    displayName: "Hider",
    role: "hider",
});
await host.req("PUT", `/api/games/${gameId}/geo/polyGeoJSON`, {
    value: {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [4, 51],
                            [6, 51],
                            [6, 53],
                            [4, 53],
                            [4, 51],
                        ],
                    ],
                },
            },
        ],
    },
});
await host.req("POST", `/api/games/${gameId}/start`);
await hider.req("PUT", `/api/games/${gameId}/hider-location`, {
    lat: 52.1,
    lng: 5.1,
});
for (let i = 0; i < 5; i++) {
    const { id } = await host.req("POST", `/api/games/${gameId}/questions`, {
        type: "radius",
        data: {
            lat: 52,
            lng: 5,
            radius: i + 1,
            unit: "kilometers",
            within: true,
        },
    });
    if (i % 2)
        await hider.req("POST", `/api/questions/${id}/answer`, {
            data: { confirmed: true },
        });
    else if (i === 4)
        await hider.req("POST", `/api/questions/${id}/veto`, {
            reason: "too easy",
        });
}
console.log(`seeded game ${roomCode}`);
