#!/usr/bin/env node
// Load / soak test: N players connected over SSE while the host mutates the
// game. Verifies every client sees every version and reports fan-out latency.
//
//   node scripts/load-sse.mjs [baseUrl] [clients=30] [mutations=50]
//
// Run it from a laptop against the Jetson (or http://localhost:8080) while
// watching `docker stats jetlag` to record memory under load.
const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");
const CLIENTS = Number(process.argv[3] ?? 30);
const MUTATIONS = Number(process.argv[4] ?? 50);
const headers = {
    "content-type": "application/json",
    "x-requested-with": "jetlag",
};

class Client {
    cookie = "";
    async req(method, path, body) {
        const res = await fetch(base + path, {
            method,
            headers: {
                ...headers,
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
const created = await host.req("POST", "/api/games", {
    displayName: "LoadHost",
    role: "seeker",
});
const { gameId, roomCode } = created;
console.log(`game ${roomCode} (${gameId})`);

const clients = [];
for (let i = 0; i < CLIENTS; i++) {
    const c = new Client();
    await c.req("POST", "/api/games/join", {
        roomCode,
        displayName: `P${i}`,
        role: i % 3 ? "seeker" : "hider",
    });
    clients.push(c);
}

const seen = clients.map(() => new Map()); // version → receive time
const controllers = [];
await Promise.all(
    clients.map(async (c, i) => {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        const res = await fetch(`${base}/api/games/${gameId}/events`, {
            headers: { cookie: c.cookie },
            signal: ctrl.signal,
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        (async () => {
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) return;
                    buffer += decoder.decode(value, { stream: true });
                    let idx;
                    while ((idx = buffer.indexOf("\n\n")) >= 0) {
                        const block = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + 2);
                        const data = /^data: (.*)$/m.exec(block)?.[1];
                        if (block.includes("event: state") && data) {
                            seen[i].set(
                                JSON.parse(data).version,
                                performance.now(),
                            );
                        }
                    }
                }
            } catch {
                /* aborted */
            }
        })();
    }),
);
console.log(`${CLIENTS} SSE streams open`);

const sentAt = new Map();
let lastVersion = 0;
for (let m = 0; m < MUTATIONS; m++) {
    const t = performance.now();
    const { version } = await host.req(
        "PATCH",
        `/api/games/${gameId}/settings`,
        { hidingRadius: m },
    );
    sentAt.set(version, t);
    lastVersion = version;
    await new Promise((r) => setTimeout(r, 50));
}
await new Promise((r) => setTimeout(r, 1500));

let missing = 0;
const latencies = [];
for (const s of seen) {
    for (const [version, t0] of sentAt) {
        const t1 = s.get(version);
        if (t1 === undefined) missing++;
        else latencies.push(t1 - t0);
    }
}
latencies.sort((a, b) => a - b);
const pct = (p) =>
    latencies[
        Math.min(latencies.length - 1, Math.floor(latencies.length * p))
    ]?.toFixed(1);
console.log(
    `events: ${latencies.length} delivered, ${missing} missing (last version ${lastVersion})`,
);
console.log(
    `fan-out latency ms: p50=${pct(0.5)} p95=${pct(0.95)} max=${pct(1)}`,
);

controllers.forEach((c) => c.abort());
for (const c of [...clients, host])
    await c.req("POST", `/api/games/${gameId}/leave`).catch(() => {});
process.exit(missing === 0 ? 0 : 1);
