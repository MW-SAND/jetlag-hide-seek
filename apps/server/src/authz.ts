/**
 * Authorization rules — the port of the original Supabase row-level-security
 * policies. Pure: no DB access, so the whole matrix is table-tested.
 */
import type { ErrorCode, GamePhase, PlayerRole } from "@jetlag/shared";

export type Action =
    | "read"
    | "leave"
    | "start"
    | "end"
    | "updateSettings"
    | "updateGeo"
    | "setHiderLocation"
    | "askQuestion"
    | "answer"
    | "undoAnswer"
    | "veto"
    | "unveto";

export interface Caller {
    playerId: string;
    role: PlayerRole;
}

export interface AuthzContext {
    phase: GamePhase;
    hostPlayerId: string | null;
    /** null when the client is not a player of this game. */
    caller: Caller | null;
    /** For undoAnswer / unveto: who created the answer / veto. */
    ownerPlayerId?: string | null;
    /** For undoAnswer. */
    undoDeadline?: number;
    now?: number;
}

export type Decision =
    | { ok: true }
    | { ok: false; code: ErrorCode; message: string };

const allow: Decision = { ok: true };
const deny = (code: ErrorCode, message: string): Decision => ({
    ok: false,
    code,
    message,
});

export function authorize(action: Action, ctx: AuthzContext): Decision {
    const { caller, phase } = ctx;
    if (!caller) return deny("forbidden", "You are not a player in this game");

    const isHost =
        ctx.hostPlayerId !== null && ctx.hostPlayerId === caller.playerId;

    switch (action) {
        case "read":
        case "leave":
            return allow;

        case "start":
            if (!isHost)
                return deny("forbidden", "Only the host can start the game");
            if (phase !== "setup")
                return deny("conflict", "The game has already started");
            return allow;

        case "end":
            if (!isHost)
                return deny("forbidden", "Only the host can end the game");
            if (phase === "ended")
                return deny("conflict", "The game has already ended");
            return allow;

        case "updateSettings":
        case "updateGeo":
            if (!isHost)
                return deny(
                    "forbidden",
                    "Only the host can change game settings",
                );
            if (phase === "ended")
                return deny("conflict", "The game has ended");
            return allow;

        case "setHiderLocation":
            if (caller.role !== "hider")
                return deny(
                    "forbidden",
                    "Only hiders can set the hider location",
                );
            if (phase === "ended")
                return deny("conflict", "The game has ended");
            return allow;

        case "askQuestion":
            if (caller.role !== "seeker")
                return deny("forbidden", "Only seekers can ask questions");
            if (phase !== "playing")
                return deny(
                    "conflict",
                    "Questions can only be asked while playing",
                );
            return allow;

        case "answer":
        case "veto":
            if (caller.role !== "hider")
                return deny(
                    "forbidden",
                    "Only hiders can answer or veto questions",
                );
            if (phase !== "playing")
                return deny("conflict", "The game is not in progress");
            return allow;

        case "undoAnswer":
            if (phase !== "playing")
                return deny("conflict", "The game is not in progress");
            if (!ctx.ownerPlayerId || ctx.ownerPlayerId !== caller.playerId)
                return deny(
                    "forbidden",
                    "Only the hider who answered can undo it",
                );
            if ((ctx.now ?? Date.now()) >= (ctx.undoDeadline ?? 0))
                return deny("forbidden", "Undo window has expired");
            return allow;

        case "unveto":
            if (phase !== "playing")
                return deny("conflict", "The game is not in progress");
            if (!ctx.ownerPlayerId || ctx.ownerPlayerId !== caller.playerId)
                return deny(
                    "forbidden",
                    "Only the hider who vetoed can remove the veto",
                );
            return allow;
    }
}
