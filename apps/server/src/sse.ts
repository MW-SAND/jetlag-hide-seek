import type { ServerResponse } from "node:http";

import type { StateEvent } from "@jetlag/shared";

interface Stream {
    res: ServerResponse;
    gameId: string;
    playerId: string;
    clientId: string;
    openedAt: number;
}

export const MAX_STREAMS = 500;
export const MAX_STREAMS_PER_CLIENT = 5;

/** In-memory fan-out of game change notifications (single-instance by design). */
export function createSseHub(heartbeatMs: number) {
    const byGame = new Map<string, Set<Stream>>();
    const all = new Set<Stream>();
    let seq = 0;

    const write = (stream: Stream, chunk: string) => {
        if (!stream.res.writableEnded) stream.res.write(chunk);
    };

    const remove = (stream: Stream) => {
        all.delete(stream);
        const set = byGame.get(stream.gameId);
        if (set) {
            set.delete(stream);
            if (set.size === 0) byGame.delete(stream.gameId);
        }
    };

    const end = (stream: Stream) => {
        remove(stream);
        if (!stream.res.writableEnded) stream.res.end();
    };

    const heartbeat = setInterval(() => {
        for (const stream of all) write(stream, ": ping\n\n");
    }, heartbeatMs);
    heartbeat.unref();

    const stateChunk = (event: StateEvent) =>
        `event: state\ndata: ${JSON.stringify(event)}\n\n`;

    return {
        open(
            res: ServerResponse,
            info: {
                gameId: string;
                playerId: string;
                clientId: string;
                event: StateEvent;
            },
        ) {
            // Per-client cap: close the oldest of this client's streams.
            const mine = [...all]
                .filter((s) => s.clientId === info.clientId)
                .sort((a, b) => a.openedAt - b.openedAt);
            while (mine.length >= MAX_STREAMS_PER_CLIENT) end(mine.shift()!);
            if (all.size >= MAX_STREAMS) {
                const oldest = [...all].sort(
                    (a, b) => a.openedAt - b.openedAt,
                )[0];
                if (oldest) end(oldest);
            }

            res.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            });
            const stream: Stream = { res, ...info, openedAt: seq++ };
            all.add(stream);
            let set = byGame.get(info.gameId);
            if (!set) byGame.set(info.gameId, (set = new Set()));
            set.add(stream);
            res.on("close", () => remove(stream));

            write(stream, "retry: 3000\n\n");
            write(stream, stateChunk(info.event));
        },

        broadcast(gameId: string, event: StateEvent) {
            const chunk = stateChunk(event);
            for (const stream of byGame.get(gameId) ?? []) write(stream, chunk);
        },

        removePlayer(gameId: string, playerId: string) {
            for (const stream of [...(byGame.get(gameId) ?? [])]) {
                if (stream.playerId !== playerId) continue;
                write(stream, "event: removed\ndata: {}\n\n");
                end(stream);
            }
        },

        removeGame(gameId: string) {
            for (const stream of [...(byGame.get(gameId) ?? [])]) {
                write(stream, "event: removed\ndata: {}\n\n");
                end(stream);
            }
        },

        count: () => all.size,

        closeAll() {
            clearInterval(heartbeat);
            for (const stream of [...all]) end(stream);
        },
    };
}

export type SseHub = ReturnType<typeof createSseHub>;
