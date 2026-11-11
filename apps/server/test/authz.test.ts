import type { GamePhase, PlayerRole } from "@jetlag/shared";
import { describe, expect, it } from "vitest";

import { type Action, authorize } from "../src/authz.ts";

type CallerKind = "hostHider" | "hostSeeker" | "hider" | "seeker" | "outsider";

const callers: Record<
    CallerKind,
    { playerId: string; role: PlayerRole } | null
> = {
    hostHider: { playerId: "H", role: "hider" },
    hostSeeker: { playerId: "H", role: "seeker" },
    hider: { playerId: "h2", role: "hider" },
    seeker: { playerId: "s1", role: "seeker" },
    outsider: null,
};

const phases: GamePhase[] = ["setup", "playing", "ended"];

/** Expected allow-set per action: (caller, phase) → allowed? */
const expected: Record<
    Exclude<Action, "undoAnswer" | "unveto">,
    (c: CallerKind, p: GamePhase) => boolean
> = {
    read: (c) => c !== "outsider",
    leave: (c) => c !== "outsider",
    start: (c, p) => (c === "hostHider" || c === "hostSeeker") && p === "setup",
    end: (c, p) => (c === "hostHider" || c === "hostSeeker") && p !== "ended",
    updateSettings: (c, p) =>
        (c === "hostHider" || c === "hostSeeker") && p !== "ended",
    updateGeo: (c, p) =>
        (c === "hostHider" || c === "hostSeeker") && p !== "ended",
    setHiderLocation: (c, p) =>
        (c === "hostHider" || c === "hider") && p !== "ended",
    askQuestion: (c, p) =>
        (c === "hostSeeker" || c === "seeker") && p === "playing",
    answer: (c, p) => (c === "hostHider" || c === "hider") && p === "playing",
    veto: (c, p) => (c === "hostHider" || c === "hider") && p === "playing",
};

describe("authorization matrix (ported RLS)", () => {
    for (const [action, rule] of Object.entries(expected)) {
        for (const kind of Object.keys(callers) as CallerKind[]) {
            for (const phase of phases) {
                const allowed = rule(kind, phase);
                it(`${action} by ${kind} during ${phase} → ${allowed ? "allow" : "deny"}`, () => {
                    const decision = authorize(action as Action, {
                        phase,
                        hostPlayerId: "H",
                        caller: callers[kind],
                    });
                    expect(decision.ok).toBe(allowed);
                    if (kind === "outsider")
                        expect(decision).toMatchObject({ code: "forbidden" });
                });
            }
        }
    }

    describe("undoAnswer", () => {
        const base = {
            phase: "playing" as const,
            hostPlayerId: "H",
            caller: callers.hider,
            ownerPlayerId: "h2",
            undoDeadline: 1000,
        };
        it("allows the answering hider before the deadline", () => {
            expect(authorize("undoAnswer", { ...base, now: 999 }).ok).toBe(
                true,
            );
        });
        it("denies at/after the deadline", () => {
            expect(
                authorize("undoAnswer", { ...base, now: 1000 }),
            ).toMatchObject({
                ok: false,
                message: "Undo window has expired",
            });
        });
        it("denies another hider", () => {
            expect(
                authorize("undoAnswer", {
                    ...base,
                    ownerPlayerId: "other",
                    now: 1,
                }).ok,
            ).toBe(false);
        });
        it("denies when the answerer has left (owner null)", () => {
            expect(
                authorize("undoAnswer", {
                    ...base,
                    ownerPlayerId: null,
                    now: 1,
                }).ok,
            ).toBe(false);
        });
        it("denies outside the playing phase", () => {
            expect(
                authorize("undoAnswer", { ...base, phase: "ended", now: 1 }).ok,
            ).toBe(false);
        });
    });

    describe("unveto", () => {
        const base = {
            phase: "playing" as const,
            hostPlayerId: "H",
            caller: callers.hider,
        };
        it("allows the vetoing hider", () => {
            expect(
                authorize("unveto", { ...base, ownerPlayerId: "h2" }).ok,
            ).toBe(true);
        });
        it("denies others", () => {
            expect(
                authorize("unveto", { ...base, ownerPlayerId: "H" }).ok,
            ).toBe(false);
            expect(
                authorize("unveto", {
                    ...base,
                    caller: callers.seeker,
                    ownerPlayerId: "h2",
                }).ok,
            ).toBe(false);
        });
    });

    it("treats a game without host as host-less", () => {
        expect(
            authorize("start", {
                phase: "setup",
                hostPlayerId: null,
                caller: callers.hostHider,
            }).ok,
        ).toBe(false);
    });
});
