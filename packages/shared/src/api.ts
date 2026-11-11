/**
 * HTTP + SSE contract between apps/web and apps/server.
 *
 * Conventions
 * - All bodies are JSON. Errors are `{ error: { code, message } }`.
 * - Identity is an opaque HttpOnly cookie (`jl_client`) issued by the server.
 * - Every mutation bumps the game's `version`; geo fields additionally bump
 *   their own entry in `geoVersions`. The SSE stream only carries version
 *   numbers, never game data, so it cannot leak role-restricted state. Clients
 *   re-fetch `/state` (and changed geo fields) when versions move.
 *
 * Endpoints
 *   POST   /api/games                          createGameRequest   -> gameSessionResponse
 *   POST   /api/games/join                     joinGameRequest     -> gameSessionResponse
 *   GET    /api/games/by-code/:roomCode        (rejoin)            -> gameSessionResponse
 *   GET    /api/games/:gameId/state                                -> gameStateSchema
 *   GET    /api/games/:gameId/geo                                  -> geoDataSchema
 *   GET    /api/games/:gameId/geo/:field                           -> { value }
 *   GET    /api/games/:gameId/events           SSE (see below)
 *   POST   /api/games/:gameId/leave                                -> 204
 *   POST   /api/games/:gameId/start            host, setup         -> mutationResponse
 *   POST   /api/games/:gameId/end              host, not ended     -> mutationResponse
 *   PATCH  /api/games/:gameId/settings         host, not ended     -> mutationResponse
 *   PUT    /api/games/:gameId/geo/:field       host, not ended     -> mutationResponse
 *   PUT    /api/games/:gameId/hider-location   hider               -> mutationResponse
 *   POST   /api/games/:gameId/questions        seeker, playing     -> mutationResponse (id)
 *   POST   /api/questions/:questionId/answer   hider, playing      -> mutationResponse (id)
 *   DELETE /api/answers/:answerId              answerer, < 30 s    -> mutationResponse
 *   POST   /api/questions/:questionId/veto     hider, playing      -> mutationResponse (id)
 *   DELETE /api/vetoes/:vetoId                 vetoer, playing     -> mutationResponse
 *   POST   /api/shares                         anyone (rate lim.)  -> createShareResponse
 *   GET    /api/shares/:id                                         -> getShareResponse
 *   GET    /healthz                                                -> { ok: true, version }
 */
import { z } from "zod";

import {
    DISPLAY_NAME_MAX,
    DISPLAY_NAME_MIN,
    GEO_FIELDS,
    ROOM_CODE_PATTERN,
    VETO_REASON_MAX,
} from "./constants.ts";

// ─── Primitives ──────────────────────────────────────────────

export const gamePhaseSchema = z.enum(["setup", "playing", "ended"]);
export type GamePhase = z.infer<typeof gamePhaseSchema>;

export const playerRoleSchema = z.enum(["hider", "seeker"]);
export type PlayerRole = z.infer<typeof playerRoleSchema>;

export const geoFieldSchema = z.enum(GEO_FIELDS);
export type GeoField = z.infer<typeof geoFieldSchema>;

export const QUESTION_TYPES = [
    "radius",
    "thermometer",
    "tentacles",
    "matching",
    "measuring",
] as const;
export const questionTypeSchema = z.enum(QUESTION_TYPES);

export const displayNameSchema = z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(DISPLAY_NAME_MIN).max(DISPLAY_NAME_MAX));

export const roomCodeSchema = z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(ROOM_CODE_PATTERN, "Invalid room code"));

const jsonObject = z.record(z.string(), z.unknown());

// ─── Entities (responses) ────────────────────────────────────

export const playerSchema = z.object({
    id: z.string(),
    displayName: z.string(),
    role: playerRoleSchema,
    joinedAt: z.string(),
});
export type Player = z.infer<typeof playerSchema>;

export const gameSettingsSchema = z.object({
    hidingRadius: z.number().nonnegative().nullable(),
    hidingRadiusUnits: z.string().max(32).nullable(),
    displayHidingZonesOptions: z.array(z.string().max(200)).max(100).nullable(),
});
export type GameSettings = z.infer<typeof gameSettingsSchema>;

export const answerSchema = z.object({
    id: z.string(),
    answeredBy: z.string().nullable(),
    data: jsonObject,
    answeredAt: z.string(),
    undoDeadline: z.string(),
});
export type Answer = z.infer<typeof answerSchema>;

export const vetoSchema = z.object({
    id: z.string(),
    vetoedBy: z.string().nullable(),
    reason: z.string().nullable(),
    createdAt: z.string(),
});
export type Veto = z.infer<typeof vetoSchema>;

export const committedQuestionSchema = z.object({
    id: z.string(),
    order: z.number().int(),
    askedBy: z.string().nullable(),
    type: z.string(),
    data: jsonObject,
    createdAt: z.string(),
    answer: answerSchema.nullable(),
    veto: vetoSchema.nullable(),
});
export type CommittedQuestionDTO = z.infer<typeof committedQuestionSchema>;

export const hiderLocationSchema = z.object({
    lat: z.number(),
    lng: z.number(),
    updatedAt: z.string(),
});
export type HiderLocation = z.infer<typeof hiderLocationSchema>;

export const geoVersionsSchema = z.object({
    mapGeoLocation: z.number().int(),
    polyGeoJSON: z.number().int(),
    customStations: z.number().int(),
    permanentOverlay: z.number().int(),
});
export type GeoVersions = z.infer<typeof geoVersionsSchema>;

/** Everything except the (large) geo fields. Filtered per caller role. */
export const gameStateSchema = z.object({
    version: z.number().int(),
    geoVersions: geoVersionsSchema,
    game: z.object({
        id: z.string(),
        roomCode: z.string(),
        phase: gamePhaseSchema,
        hostPlayerId: z.string().nullable(),
        createdAt: z.string(),
        expiresAt: z.string(),
        settings: gameSettingsSchema,
    }),
    players: z.array(playerSchema),
    questions: z.array(committedQuestionSchema),
    /** Present (possibly null) only when the caller is a hider. */
    hiderLocation: hiderLocationSchema.nullable().optional(),
    you: z.object({
        playerId: z.string(),
        role: playerRoleSchema,
        isHost: z.boolean(),
    }),
});
export type GameState = z.infer<typeof gameStateSchema>;

export const geoDataSchema = z.object({
    mapGeoLocation: z.unknown().nullable(),
    polyGeoJSON: z.unknown().nullable(),
    customStations: z.unknown().nullable(),
    permanentOverlay: z.unknown().nullable(),
});
export type GeoData = z.infer<typeof geoDataSchema>;

// ─── Requests ────────────────────────────────────────────────

export const createGameRequest = z.object({
    displayName: displayNameSchema,
    role: playerRoleSchema.default("hider"),
});
export type CreateGameRequest = z.input<typeof createGameRequest>;

export const joinGameRequest = z.object({
    roomCode: roomCodeSchema,
    displayName: displayNameSchema,
    role: playerRoleSchema.default("seeker"),
});
export type JoinGameRequest = z.input<typeof joinGameRequest>;

export const gameSessionResponse = z.object({
    gameId: z.string(),
    roomCode: z.string(),
    playerId: z.string(),
    phase: gamePhaseSchema,
    alreadyJoined: z.boolean().optional(),
});
export type GameSessionResponse = z.infer<typeof gameSessionResponse>;

export const updateSettingsRequest = gameSettingsSchema.partial();
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequest>;

export const putGeoRequest = z.object({ value: z.unknown().nullable() });

export const putHiderLocationRequest = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});

export const createQuestionRequest = z.object({
    type: questionTypeSchema,
    data: jsonObject.refine((d) => d.drag !== true, {
        message: "Question must be locked before sending",
    }),
});
export type CreateQuestionRequest = z.infer<typeof createQuestionRequest>;

export const answerQuestionRequest = z.object({ data: jsonObject });

export const vetoQuestionRequest = z.object({
    reason: z
        .string()
        .trim()
        .max(VETO_REASON_MAX)
        .nullable()
        .optional()
        .transform((r) => (r ? r : null)),
});

export const createShareRequest = z.object({ data: z.string().min(1) });
export const createShareResponse = z.object({ id: z.string() });
export const getShareResponse = z.object({ data: z.string() });

export const mutationResponse = z.object({
    version: z.number().int(),
    id: z.string().optional(),
});
export type MutationResponse = z.infer<typeof mutationResponse>;

// ─── SSE ─────────────────────────────────────────────────────

/**
 * GET /api/games/:gameId/events — `text/event-stream`.
 * - `event: state` with a StateEvent JSON payload immediately on connect and
 *   after every change to the game.
 * - `event: removed` (empty payload) when the caller is no longer a player in
 *   the game (left from another tab / game expired); the server then closes.
 * - `: ping` comment lines as heartbeat.
 */
export const stateEventSchema = z.object({
    version: z.number().int(),
    geoVersions: geoVersionsSchema,
});
export type StateEvent = z.infer<typeof stateEventSchema>;

// ─── Errors ──────────────────────────────────────────────────

export const errorCodeSchema = z.enum([
    "invalid",
    "not_found",
    "forbidden",
    "conflict",
    "rate_limited",
    "too_large",
    "internal",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
    invalid: 400,
    not_found: 404,
    forbidden: 403,
    conflict: 409,
    rate_limited: 429,
    too_large: 413,
    internal: 500,
};

export const errorResponseSchema = z.object({
    error: z.object({ code: errorCodeSchema, message: z.string() }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
