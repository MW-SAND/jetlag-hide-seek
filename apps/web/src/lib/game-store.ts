/**
 * Multiplayer state atoms. Kept free of logic so every multiplayer module can
 * import it without circular dependencies.
 */
import type {
    CommittedQuestionDTO,
    GamePhase,
    GameState,
    PlayerRole,
} from "@jetlag/shared";
import { atom, computed } from "nanostores";

export interface GameSession {
    gameId: string;
    roomCode: string;
    playerId: string;
    phase: GamePhase;
    /** Player id of the current host (null if the host left with nobody left). */
    hostId: string | null;
}

export interface Player {
    id: string;
    display_name: string;
    role: PlayerRole;
    joined_at: string;
}

export type AppView = "landing" | "lobby" | "game" | "ended";

export type RealtimeStatus = "connected" | "connecting" | "disconnected";

export interface CommittedAnswer {
    dbId: string;
    answeredBy: string | null;
    answerData: Record<string, unknown>;
    answeredAt: string;
    undoDeadline: string;
}

export interface CommittedVeto {
    dbId: string;
    vetoedBy: string | null;
    reason: string | null;
    createdAt: string;
}

export interface CommittedQuestion {
    dbId: string;
    order: number;
    askedBy: string | null;
    questionType: string;
    questionData: Record<string, unknown>;
    answer: CommittedAnswer | null;
    veto: CommittedVeto | null;
    createdAt: string;
}

export const appView = atom<AppView>("landing");
export const gameSession = atom<GameSession | null>(null);
export const players = atom<Player[]>([]);
export const multiplayerError = atom<string | null>(null);
export const multiplayerLoading = atom<boolean>(false);
export const realtimeStatus = atom<RealtimeStatus>("connecting");

/** Latest role-filtered state received from the server. */
export const gameState = atom<GameState | null>(null);

/**
 * True once the local map stores hold the game's area/settings. The map waits
 * for this so nobody computes (and downloads) a stale local area first.
 */
export const syncReady = atom<boolean>(false);

/** All committed questions for the current game (sorted by order). */
export const committedQuestions = atom<CommittedQuestion[]>([]);

export const currentPlayer = computed(
    [gameSession, players],
    (session, all) => {
        if (!session) return null;
        return all.find((p) => p.id === session.playerId) ?? null;
    },
);

export const isHost = computed(
    gameSession,
    (session) => !!session && session.hostId === session.playerId,
);

export const toCommittedQuestion = (
    q: CommittedQuestionDTO,
): CommittedQuestion => ({
    dbId: q.id,
    order: q.order,
    askedBy: q.askedBy,
    questionType: q.type,
    questionData: q.data,
    createdAt: q.createdAt,
    answer: q.answer
        ? {
              dbId: q.answer.id,
              answeredBy: q.answer.answeredBy,
              answerData: q.answer.data,
              answeredAt: q.answer.answeredAt,
              undoDeadline: q.answer.undoDeadline,
          }
        : null,
    veto: q.veto
        ? {
              dbId: q.veto.id,
              vetoedBy: q.veto.vetoedBy,
              reason: q.veto.reason,
              createdAt: q.veto.createdAt,
          }
        : null,
});
