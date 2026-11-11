import { afterEach, describe, expect, test, vi } from "vitest";

// question-store pulls in the API/connection modules; keep them inert here.
vi.mock("@/lib/api", () => ({ api: {} }));
vi.mock("@/lib/connection", () => ({ refreshState: vi.fn() }));

const { committedQuestions, gameSession, players } = await import(
    "@/lib/game-store"
);
const { questionsForMap } = await import("@/lib/question-store");

const q = (dbId: string | undefined, drag = false) => ({
    id: "radius",
    key: Math.random(),
    data: { drag, ...(dbId ? { _dbId: dbId } : {}) },
});

const committed = (dbId: string, state: "waiting" | "answered" | "vetoed") => ({
    dbId,
    order: 1,
    askedBy: null,
    questionType: "radius",
    questionData: {},
    createdAt: "2024-01-01T00:00:00Z",
    answer:
        state === "answered"
            ? {
                  dbId: `a-${dbId}`,
                  answeredBy: null,
                  answerData: { confirmed: true },
                  answeredAt: "2024-01-01T00:00:00Z",
                  undoDeadline: "2024-01-01T00:00:00Z",
              }
            : null,
    veto:
        state === "vetoed"
            ? {
                  dbId: `v-${dbId}`,
                  vetoedBy: null,
                  reason: null,
                  createdAt: "2024-01-01T00:00:00Z",
              }
            : null,
});

function inGameAs(role: "seeker" | "hider") {
    gameSession.set({
        gameId: "g",
        roomCode: "ABCDEF",
        playerId: "me",
        phase: "playing",
        hostId: "me",
    });
    players.set([
        { id: "me", display_name: "Me", role, joined_at: "2024-01-01" },
    ]);
    committedQuestions.set([
        committed("waiting", "waiting"),
        committed("answered", "answered"),
        committed("vetoed", "vetoed"),
    ] as any);
}

afterEach(() => {
    gameSession.set(null);
    players.set([]);
    committedQuestions.set([]);
});

const list = [
    q(undefined, false), // locked draft
    q(undefined, true), // unlocked draft
    q("waiting"),
    q("answered"),
    q("vetoed"),
    q("unknown"),
];
const ids = (qs: typeof list) =>
    qs.map((x) => (x.data as any)._dbId ?? (x.data.drag ? "draft" : "locked"));

describe("questionsForMap", () => {
    test("outside a game every question counts", () => {
        expect(questionsForMap(list, false)).toHaveLength(list.length);
    });

    test("seekers only learn from answered, non-vetoed questions", () => {
        inGameAs("seeker");
        expect(ids(questionsForMap(list, false))).toEqual(["answered"]);
    });

    test("in planning mode, unlocked drafts are included as outlines", () => {
        inGameAs("seeker");
        expect(ids(questionsForMap(list, true))).toEqual(["draft", "answered"]);
    });

    test("hiders preview waiting questions but never vetoed ones", () => {
        inGameAs("hider");
        expect(ids(questionsForMap(list, false))).toEqual([
            "waiting",
            "answered",
        ]);
    });
});
