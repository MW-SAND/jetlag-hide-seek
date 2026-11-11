/**
 * Multiplayer session lifecycle: create / join / rejoin / start / end / leave.
 */
import type {
    GamePhase,
    GameSessionResponse,
    PlayerRole,
} from "@jetlag/shared";

import { api, ApiError } from "./api";
import {
    closeConnection,
    refreshState,
    setRemovedHandler,
    subscribeToGame,
} from "./connection";
import {
    type AppView,
    appView,
    committedQuestions,
    gameSession,
    gameState,
    multiplayerError,
    multiplayerLoading,
    players,
} from "./game-store";
import { forgetRoom, rememberRoom } from "./preferences";

export { subscribeToGame } from "./connection";
export type { AppView, GameSession, Player } from "./game-store";
export {
    appView,
    currentPlayer,
    gameSession,
    isHost,
    multiplayerError,
    multiplayerLoading,
    players,
} from "./game-store";

const viewForPhase = (phase: GamePhase): AppView =>
    phase === "setup" ? "lobby" : phase === "playing" ? "game" : "ended";

const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

/** Work to finish before leaving (e.g. flushing debounced writes). */
const beforeLeave = new Set<() => Promise<void>>();
export const registerBeforeLeave = (fn: () => Promise<void>) => {
    beforeLeave.add(fn);
    return () => beforeLeave.delete(fn);
};

async function startSession(res: GameSessionResponse) {
    rememberRoom(res.roomCode);
    gameSession.set({
        gameId: res.gameId,
        roomCode: res.roomCode,
        playerId: res.playerId,
        phase: res.phase,
        hostId: null,
    });
    window.location.hash = `game/${res.roomCode}`;
    // Switching away from "landing" lets state updates drive the view.
    appView.set(viewForPhase(res.phase));
    await subscribeToGame(res.gameId);
    await refreshState(res.gameId);
}

async function run(action: () => Promise<void>, fallback: string) {
    multiplayerError.set(null);
    multiplayerLoading.set(true);
    try {
        await action();
    } catch (error) {
        multiplayerError.set(errorMessage(error, fallback));
    } finally {
        multiplayerLoading.set(false);
    }
}

export function createGame(displayName: string, role: PlayerRole) {
    return run(async () => {
        await startSession(await api.createGame({ displayName, role }));
    }, "Failed to create game");
}

export function joinGame(
    roomCode: string,
    displayName: string,
    role: PlayerRole,
) {
    return run(async () => {
        await startSession(await api.joinGame({ roomCode, displayName, role }));
    }, "Failed to join game");
}

/**
 * Rejoin a game this browser is already part of (e.g. after a refresh).
 * Returns false when this browser is not a player of that game.
 */
export async function rejoinGame(roomCode: string): Promise<boolean> {
    try {
        const res = await api.rejoin(roomCode.trim().toUpperCase());
        await startSession(res);
        return true;
    } catch (error) {
        if (
            error instanceof ApiError &&
            error.status !== 0 &&
            error.status < 500
        )
            return false;
        multiplayerError.set(errorMessage(error, "Failed to rejoin game"));
        return false;
    }
}

export async function fetchPlayers(gameId: string) {
    await refreshState(gameId);
}

async function changePhase(action: "start" | "end") {
    const session = gameSession.get();
    if (!session) return;
    try {
        await (action === "start"
            ? api.start(session.gameId)
            : api.end(session.gameId));
        await refreshState(session.gameId);
    } catch (error) {
        multiplayerError.set(errorMessage(error, `Failed to ${action} game`));
    }
}

export const startGame = () => changePhase("start");
export const endGame = () => changePhase("end");

function resetLocalState() {
    const roomCode = gameSession.get()?.roomCode;
    if (roomCode) forgetRoom(roomCode);
    closeConnection();
    gameSession.set(null);
    gameState.set(null);
    players.set([]);
    committedQuestions.set([]);
    // The map stores are only loaded once a game was shown (keeps the landing
    // page bundle small); clear them if they exist.
    void import("./question-store").then((m) => {
        m.draftQuestions.set([]);
        m.answerDraftSelections.set({});
    });
    void import("./context").then((m) => m.questions.set([]));
    appView.set("landing");
    if (window.location.hash) {
        window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${window.location.search}`,
        );
    }
}

export async function leaveGame() {
    const session = gameSession.get();
    await Promise.allSettled([...beforeLeave].map((fn) => fn()));
    if (session) {
        // Fire and forget: the UI must not hang if the server is unreachable.
        api.leave(session.gameId).catch((error) =>
            console.warn("leave failed", error),
        );
    }
    multiplayerError.set(null);
    resetLocalState();
}

setRemovedHandler((reason) => {
    if (!gameSession.get()) return;
    void import("react-toastify").then(({ toast }) => toast.info(reason));
    resetLocalState();
});

export function initFromHash() {
    const match = window.location.hash.match(/^#game\/([A-Z0-9]{6})$/i);
    return match ? match[1].toUpperCase() : null;
}
