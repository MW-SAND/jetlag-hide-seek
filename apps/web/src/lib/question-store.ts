/**
 * Multiplayer question + answer store.
 *
 * Seekers draft questions locally, then commit them to the server. Hiders
 * answer or veto committed questions. The connection module keeps
 * `committedQuestions` in sync for every client.
 */
import type { Question } from "@jetlag/geo/schema";
import { atom, computed } from "nanostores";

import { api } from "./api";
import { refreshState } from "./connection";
import { questions as localQuestions } from "./context";
import {
    type CommittedQuestion,
    committedQuestions,
    currentPlayer,
    gameSession,
} from "./game-store";

export type {
    CommittedAnswer,
    CommittedQuestion,
    CommittedVeto,
} from "./game-store";
export { committedQuestions } from "./game-store";

export interface DraftAnswerSelection {
    confirmed: boolean;
    selectedTentacleName?: string;
    selectedTentacleLocation?: any;
}

// ─── Stores ──────────────────────────────────────────────────

/** Local draft questions being built by the current seeker (not yet sent) */
export const draftQuestions = atom<Question[]>([]);

/** Hider-only local answer selections before submitting */
export const answerDraftSelections = atom<Record<string, DraftAnswerSelection>>(
    {},
);

/** Derived: questions that have been answered (for map rendering) */
export const answeredQuestions = computed(committedQuestions, (qs) =>
    qs.filter((q) => q.answer !== null && q.veto === null),
);

/** Derived: questions awaiting an answer from hiders (not answered, not vetoed) */
export const unansweredQuestions = computed(committedQuestions, (qs) =>
    qs.filter((q) => q.answer === null && q.veto === null),
);

/** Derived: questions a hider has vetoed */
export const vetoedQuestions = computed(committedQuestions, (qs) =>
    qs.filter((q) => q.veto !== null),
);

export function applyAnswerToQuestionData(
    questionType: string,
    questionData: Record<string, unknown>,
    answerData: Record<string, unknown>,
): Record<string, unknown> {
    const next = { ...questionData } as any;
    const confirmed = !!answerData.confirmed;

    if (
        questionType === "tentacles" &&
        Object.prototype.hasOwnProperty.call(
            answerData,
            "selectedTentacleLocation",
        )
    ) {
        next.location = (answerData as any).selectedTentacleLocation;
        return next;
    }

    if (confirmed) return next;

    switch (questionType) {
        case "radius":
            next.within = !next.within;
            break;
        case "thermometer":
            next.warmer = !next.warmer;
            break;
        case "measuring":
            next.hiderCloser = !next.hiderCloser;
            break;
        case "matching":
            next.same = !next.same;
            break;
        case "tentacles":
            next.location = false;
            break;
    }

    return next;
}

function tentacleLocationKey(value: any): string {
    if (!value || value === false) return "false";
    const name = value?.properties?.name;
    const coords = value?.geometry?.coordinates;
    return `${String(name ?? "")}:${JSON.stringify(coords ?? [])}`;
}

export function deriveTentacleConfirmed(
    originalLocation: any,
    selectedLocation: any,
): boolean {
    return (
        tentacleLocationKey(originalLocation) ===
        tentacleLocationKey(selectedLocation)
    );
}

// The geo engine is heavy: load it only when a hider actually needs it.
const simulateHider = async (question: CommittedQuestion) => {
    const { hiderifyQuestion } = await import("@jetlag/geo");
    return hiderifyQuestion({
        id: question.questionType as any,
        key: -1,
        data: {
            ...(question.questionData as Record<string, unknown>),
            drag: true,
            collapsed: true,
        },
    } as any);
};

export async function deriveSuggestedConfirmed(
    question: CommittedQuestion,
): Promise<boolean> {
    const original = {
        ...(question.questionData as Record<string, unknown>),
    } as any;
    const resolved = (await simulateHider(question)).data as any;

    switch (question.questionType) {
        case "radius":
            return resolved.within === original.within;
        case "thermometer":
            return resolved.warmer === original.warmer;
        case "measuring":
            return resolved.hiderCloser === original.hiderCloser;
        case "matching":
            return resolved.same === original.same;
        case "tentacles":
            return (
                tentacleLocationKey(resolved.location) ===
                tentacleLocationKey(original.location)
            );
        default:
            return true;
    }
}

export async function deriveSuggestedTentacleSelection(
    question: CommittedQuestion,
): Promise<{
    selectedTentacleName: string;
    selectedTentacleLocation: any;
    confirmed: boolean;
}> {
    const original = {
        ...(question.questionData as Record<string, unknown>),
    } as any;
    const resolvedLocation = ((await simulateHider(question)).data as any)
        .location;
    return {
        selectedTentacleName:
            resolvedLocation === false
                ? "false"
                : String(resolvedLocation?.properties?.name ?? "false"),
        selectedTentacleLocation: resolvedLocation,
        confirmed: deriveTentacleConfirmed(original.location, resolvedLocation),
    };
}

export function setDraftAnswerSelection(
    question: CommittedQuestion,
    answerData: DraftAnswerSelection,
) {
    answerDraftSelections.set({
        ...answerDraftSelections.get(),
        [question.dbId]: answerData,
    });

    const resolvedData = applyAnswerToQuestionData(
        question.questionType,
        question.questionData,
        answerData as unknown as Record<string, unknown>,
    );

    localQuestions.set(
        localQuestions.get().map((q) =>
            (q.data as any)._dbId === question.dbId
                ? {
                      ...q,
                      data: {
                          ...resolvedData,
                          drag: false,
                          collapsed: true,
                          _dbId: question.dbId,
                      },
                  }
                : q,
        ) as any,
    );
}

export function clearDraftAnswerSelection(questionDbId: string) {
    const next = { ...answerDraftSelections.get() };
    delete next[questionDbId];
    answerDraftSelections.set(next);
}

// ─── Fetch ───────────────────────────────────────────────────

/** Re-fetch the game state (committed questions included). */
export async function fetchCommittedQuestions(gameId: string) {
    await refreshState(gameId);
}

/** Kept for API compatibility: the game connection already streams Q&A changes. */
export function subscribeToQuestions(_gameId: string) {}
export function unsubscribeFromQuestions() {}

// ─── Seeker actions ──────────────────────────────────────────

const requireSession = () => {
    const session = gameSession.get();
    const player = currentPlayer.get();
    if (!session || !player) throw new Error("Not in a game");
    return session;
};

/** Commit a question from the seeker's local draft to the server. */
export async function commitQuestion(question: Question) {
    const session = requireSession();
    const {
        drag: _drag,
        collapsed: _collapsed,
        _dbId,
        ...data
    } = question.data as unknown as Record<string, unknown>;

    const { id } = await api.askQuestion(session.gameId, {
        type: question.id as any,
        data,
    });

    // Tag the local question with its server id so the sidebar knows it's
    // committed and won't offer "Send to Hider" again.
    localQuestions.set(
        localQuestions
            .get()
            .map((q) =>
                q.key === question.key
                    ? { ...q, data: { ...q.data, _dbId: id } }
                    : q,
            ) as any,
    );

    await refreshState(session.gameId);
}

// ─── Hider actions ───────────────────────────────────────────

export async function answerQuestion(
    questionDbId: string,
    answerData: DraftAnswerSelection | Record<string, unknown>,
) {
    const session = requireSession();
    await api.answer(questionDbId, answerData as Record<string, unknown>);
    clearDraftAnswerSelection(questionDbId);
    await refreshState(session.gameId);
}

/** Veto a committed question (hiders only). Removes it from the answer queue. */
export async function vetoQuestion(
    questionDbId: string,
    reason?: string | null,
) {
    const session = requireSession();
    await api.veto(questionDbId, reason ?? null);
    clearDraftAnswerSelection(questionDbId);
    await refreshState(session.gameId);
}

/** Undo an answer (only before its undo deadline). */
export async function undoAnswer(answerDbId: string) {
    const session = requireSession();
    await api.undoAnswer(answerDbId);
    await refreshState(session.gameId);
}

/** Remove a veto (only by the hider who vetoed). */
export async function unvetoQuestion(vetoDbId: string) {
    const session = requireSession();
    await api.unveto(vetoDbId);
    await refreshState(session.gameId);
}
