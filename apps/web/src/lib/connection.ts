/**
 * Realtime connection to the server for the current game.
 *
 * One EventSource per game. The stream only carries version numbers; whenever
 * the server's version differs from ours we re-fetch the (role-filtered)
 * state. EventSource reconnects on its own, and the server always sends the
 * current version first, so missed events are impossible.
 */
import type { GameState, StateEvent } from "@jetlag/shared";

import { api, ApiError } from "./api";
import {
    appView,
    committedQuestions,
    gameSession,
    gameState,
    players,
    realtimeStatus,
    toCommittedQuestion,
} from "./game-store";

interface Connection {
    gameId: string;
    source: EventSource | null;
    ready: Promise<void>;
    retryTimer: ReturnType<typeof setTimeout> | null;
}

let connection: Connection | null = null;
let localVersion = 0;
let inflight: Promise<void> | null = null;
let rerun = false;

let removedHandler: (reason: string) => void = () => {};
/** Called when the server says we're no longer part of the game. */
export const setRemovedHandler = (fn: (reason: string) => void) => {
    removedHandler = fn;
};

/** Minimal validation (keeps zod out of the landing-page bundle). */
function parseStateEvent(raw: string): StateEvent | null {
    try {
        const value = JSON.parse(raw);
        return typeof value?.version === "number" &&
            typeof value?.geoVersions === "object"
            ? (value as StateEvent)
            : null;
    } catch {
        return null;
    }
}

export function applyState(state: GameState) {
    const session = gameSession.get();
    if (!session || session.gameId !== state.game.id) return;
    localVersion = state.version;

    players.set(
        state.players.map((p) => ({
            id: p.id,
            display_name: p.displayName,
            role: p.role,
            joined_at: p.joinedAt,
        })),
    );
    committedQuestions.set(state.questions.map(toCommittedQuestion));
    gameSession.set({
        ...session,
        playerId: state.you.playerId,
        phase: state.game.phase,
        hostId: state.game.hostPlayerId,
    });
    gameState.set(state);

    const view = appView.get();
    if (view !== "landing") {
        const next =
            state.game.phase === "setup"
                ? "lobby"
                : state.game.phase === "playing"
                  ? "game"
                  : "ended";
        if (next !== view) appView.set(next);
    }
}

/** Fetch and apply the latest state. Concurrent calls are coalesced. */
export function refreshState(gameId: string): Promise<void> {
    if (inflight) {
        rerun = true;
        return inflight;
    }
    inflight = (async () => {
        do {
            rerun = false;
            try {
                const state = await api.state(gameId);
                if (gameSession.get()?.gameId !== gameId) return;
                applyState(state);
            } catch (error) {
                if (
                    error instanceof ApiError &&
                    (error.status === 403 || error.status === 404) &&
                    gameSession.get()?.gameId === gameId
                ) {
                    removedHandler(
                        error.status === 404
                            ? "This game no longer exists."
                            : "You are no longer part of this game.",
                    );
                    return;
                }
                throw error;
            }
        } while (rerun);
    })().finally(() => {
        inflight = null;
    });
    return inflight;
}

export function subscribeToGame(gameId: string): Promise<void> {
    if (connection?.gameId === gameId) return connection.ready;
    closeConnection();
    localVersion = 0;

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    const conn: Connection = { gameId, source: null, ready, retryTimer: null };
    connection = conn;
    // Never block the UI for long if the stream is slow to come up.
    setTimeout(resolveReady, 5000);

    const open = () => {
        if (connection !== conn) return;
        realtimeStatus.set("connecting");
        const source = new EventSource(api.eventsUrl(gameId));
        conn.source = source;

        source.addEventListener("state", (e) => {
            realtimeStatus.set("connected");
            const event = parseStateEvent((e as MessageEvent).data);
            if (!event) return;
            if (event.version !== localVersion) {
                refreshState(gameId)
                    .catch((error) =>
                        console.warn("[sync] refresh failed", error),
                    )
                    .finally(resolveReady);
            } else {
                resolveReady();
            }
        });

        source.addEventListener("removed", () => {
            source.close();
            if (connection === conn) {
                removedHandler("You are no longer part of this game.");
            }
        });

        source.onerror = () => {
            if (connection !== conn) return;
            if (source.readyState === EventSource.CLOSED) {
                // The browser gave up (e.g. HTTP error). Check why, then retry.
                realtimeStatus.set("disconnected");
                refreshState(gameId).catch(() => {});
                conn.retryTimer = setTimeout(open, 5000);
            } else {
                realtimeStatus.set("connecting");
            }
        };
    };
    open();
    return ready;
}

export function closeConnection() {
    if (!connection) return;
    connection.source?.close();
    if (connection.retryTimer) clearTimeout(connection.retryTimer);
    connection = null;
    localVersion = 0;
    realtimeStatus.set("disconnected");
}

/** Re-check the server when the tab comes back to the foreground. */
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && connection) {
            refreshState(connection.gameId).catch(() => {});
        }
    });
}
