import { describe, expect, it } from "vitest";

import {
    createGameRequest,
    createQuestionRequest,
    displayNameSchema,
    gameStateSchema,
    joinGameRequest,
    ROOM_CODE_ALPHABET,
    roomCodeSchema,
    vetoQuestionRequest,
} from "../src/index.ts";

describe("shared contract", () => {
    it("normalises room codes and rejects ambiguous characters", () => {
        expect(roomCodeSchema.parse(" ab2cd3 ")).toBe("AB2CD3");
        for (const bad of [
            "ABC",
            "ABCDEFG",
            "ABCDE0",
            "ABCDE1",
            "ABCDEI",
            "ABCDEO",
        ]) {
            expect(roomCodeSchema.safeParse(bad).success).toBe(false);
        }
        expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    });

    it("trims display names and enforces 1–20 characters", () => {
        expect(displayNameSchema.parse("  Matti  ")).toBe("Matti");
        expect(displayNameSchema.safeParse("   ").success).toBe(false);
        expect(displayNameSchema.safeParse("x".repeat(21)).success).toBe(false);
        expect(displayNameSchema.safeParse("x".repeat(20)).success).toBe(true);
    });

    it("defaults roles like the original RPCs", () => {
        expect(createGameRequest.parse({ displayName: "a" }).role).toBe(
            "hider",
        );
        expect(
            joinGameRequest.parse({ displayName: "a", roomCode: "AAAAAA" })
                .role,
        ).toBe("seeker");
    });

    it("rejects unlocked (drag) questions and unknown types", () => {
        expect(
            createQuestionRequest.safeParse({
                type: "radius",
                data: { drag: true },
            }).success,
        ).toBe(false);
        expect(
            createQuestionRequest.safeParse({
                type: "radius",
                data: { drag: false },
            }).success,
        ).toBe(true);
        expect(
            createQuestionRequest.safeParse({ type: "nope", data: {} }).success,
        ).toBe(false);
    });

    it("normalises empty veto reasons to null and caps length", () => {
        expect(vetoQuestionRequest.parse({ reason: "  " }).reason).toBeNull();
        expect(vetoQuestionRequest.parse({}).reason).toBeNull();
        expect(
            vetoQuestionRequest.safeParse({ reason: "x".repeat(201) }).success,
        ).toBe(false);
    });

    it("allows hiderLocation to be absent (seekers)", () => {
        const state = {
            version: 1,
            geoVersions: {
                mapGeoLocation: 0,
                polyGeoJSON: 0,
                customStations: 0,
                permanentOverlay: 0,
            },
            game: {
                id: "g",
                roomCode: "AAAAAA",
                phase: "setup",
                hostPlayerId: "p",
                createdAt: "x",
                expiresAt: "y",
                settings: {
                    hidingRadius: null,
                    hidingRadiusUnits: null,
                    displayHidingZonesOptions: null,
                },
            },
            players: [],
            questions: [],
            you: { playerId: "p", role: "seeker", isHost: true },
        };
        expect(gameStateSchema.safeParse(state).success).toBe(true);
    });
});
