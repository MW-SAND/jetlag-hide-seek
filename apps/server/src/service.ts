import crypto from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import {
    type CommittedQuestionDTO,
    type GameSessionResponse,
    type GameState,
    type GeoData,
    type GeoField,
    type GeoVersions,
    type MutationResponse,
    type PlayerRole,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    type StateEvent,
    UNDO_WINDOW_MS,
    type UpdateSettingsRequest,
} from "@jetlag/shared";

import { type Action, authorize, type Caller } from "./authz.ts";
import { tx } from "./db.ts";
import { AppError, fail } from "./errors.ts";

const GEO_COLUMNS: Record<GeoField, { data: string; version: string }> = {
    mapGeoLocation: { data: "map_geo_location", version: "v_map_geo_location" },
    polyGeoJSON: { data: "poly_geo_json", version: "v_poly_geo_json" },
    customStations: { data: "custom_stations", version: "v_custom_stations" },
    permanentOverlay: {
        data: "permanent_overlay",
        version: "v_permanent_overlay",
    },
};

const LOCAL_QUESTION_KEYS = ["drag", "collapsed", "_dbId"];

interface GameRow {
    id: string;
    room_code: string;
    phase: "setup" | "playing" | "ended";
    host_player_id: string | null;
    hiding_radius: number | null;
    hiding_radius_units: string | null;
    display_hiding_zones_options: string | null;
    version: number;
    created_at: number;
    expires_at: number;
}

interface PlayerRow {
    id: string;
    game_id: string;
    client_id: string;
    display_name: string;
    role: PlayerRole;
    joined_at: number;
}

export interface ServiceOptions {
    now: () => number;
    gameTtlMs: number;
    shareTtlMs: number;
    /** Called after every committed change to a game. */
    onChange?: (gameId: string, event: StateEvent) => void;
    /** Called when a player is removed from a game. */
    onPlayerRemoved?: (gameId: string, playerId: string) => void;
    /** Called when a whole game is deleted. */
    onGameDeleted?: (gameId: string) => void;
}

const iso = (ms: number) => new Date(ms).toISOString();
const parseJson = (text: string | null) =>
    text == null ? null : JSON.parse(text);

const randomCode = (alphabet: string, length: number) => {
    const bytes = crypto.randomBytes(length);
    let out = "";
    // alphabet length 32 / 62 → modulo bias is zero for 32 and negligible for 62.
    for (let i = 0; i < length; i++)
        out += alphabet[bytes[i] % alphabet.length];
    return out;
};

const SHARE_ALPHABET =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export type Service = ReturnType<typeof createService>;

export function createService(db: DatabaseSync, options: ServiceOptions) {
    const cache = new Map<string, StatementSync>();
    const q = (sql: string) => {
        let stmt = cache.get(sql);
        if (!stmt) {
            stmt = db.prepare(sql);
            cache.set(sql, stmt);
        }
        return stmt;
    };
    const now = options.now;

    // ─── Clients ─────────────────────────────────────────────

    const lastSeenWrites = new Map<string, number>();

    function findClient(tokenHash: string): string | null {
        const row = q("SELECT id FROM clients WHERE token_hash = ?").get(
            tokenHash,
        ) as { id: string } | undefined;
        if (!row) return null;
        const last = lastSeenWrites.get(row.id) ?? 0;
        if (now() - last > 60 * 60 * 1000) {
            lastSeenWrites.set(row.id, now());
            if (lastSeenWrites.size > 10_000) lastSeenWrites.clear();
            q("UPDATE clients SET last_seen_at = ? WHERE id = ?").run(
                now(),
                row.id,
            );
        }
        return row.id;
    }

    function ensureClient(tokenHash: string): string {
        const existing = findClient(tokenHash);
        if (existing) return existing;
        const id = crypto.randomUUID();
        q(
            "INSERT INTO clients (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        ).run(id, tokenHash, now(), now());
        lastSeenWrites.set(id, now());
        return id;
    }

    // ─── Lookups ─────────────────────────────────────────────

    const getGame = (gameId: string) =>
        q("SELECT * FROM games WHERE id = ? AND expires_at > ?").get(
            gameId,
            now(),
        ) as GameRow | undefined;

    const getGameByCode = (code: string) =>
        q("SELECT * FROM games WHERE room_code = ? AND expires_at > ?").get(
            code,
            now(),
        ) as GameRow | undefined;

    const getPlayerForClient = (gameId: string, clientId: string | null) =>
        clientId
            ? (q(
                  "SELECT * FROM players WHERE game_id = ? AND client_id = ?",
              ).get(gameId, clientId) as PlayerRow | undefined)
            : undefined;

    const requireGame = (gameId: string) =>
        getGame(gameId) ?? fail("not_found", "Game not found");

    function access(
        clientId: string | null,
        gameId: string,
        action: Action,
        extra = {},
    ) {
        const game = requireGame(gameId);
        const player = getPlayerForClient(gameId, clientId);
        const caller: Caller | null = player
            ? { playerId: player.id, role: player.role }
            : null;
        const decision = authorize(action, {
            phase: game.phase,
            hostPlayerId: game.host_player_id,
            caller,
            now: now(),
            ...extra,
        });
        if (!decision.ok) throw new AppError(decision.code, decision.message);
        return { game, player: player! };
    }

    function geoVersions(gameId: string): GeoVersions {
        const row = q(
            "SELECT v_map_geo_location, v_poly_geo_json, v_custom_stations, v_permanent_overlay FROM game_geo WHERE game_id = ?",
        ).get(gameId) as Record<string, number> | undefined;
        return {
            mapGeoLocation: row?.v_map_geo_location ?? 0,
            polyGeoJSON: row?.v_poly_geo_json ?? 0,
            customStations: row?.v_custom_stations ?? 0,
            permanentOverlay: row?.v_permanent_overlay ?? 0,
        };
    }

    function bump(gameId: string): number {
        q("UPDATE games SET version = version + 1 WHERE id = ?").run(gameId);
        const row = q("SELECT version FROM games WHERE id = ?").get(gameId) as {
            version: number;
        };
        return row.version;
    }

    function stateEvent(gameId: string): StateEvent {
        const row = q("SELECT version FROM games WHERE id = ?").get(gameId) as
            | { version: number }
            | undefined;
        return { version: row?.version ?? 0, geoVersions: geoVersions(gameId) };
    }

    /** Commit a mutation and notify listeners. */
    function mutate(gameId: string, fn: () => string | void): MutationResponse {
        const id = tx(db, () => {
            const result = fn();
            bump(gameId);
            return result;
        });
        const event = stateEvent(gameId);
        options.onChange?.(gameId, event);
        return id ? { version: event.version, id } : { version: event.version };
    }

    function insertPlayer(
        gameId: string,
        clientId: string,
        displayName: string,
        role: PlayerRole,
    ) {
        const taken = q(
            "SELECT 1 FROM players WHERE game_id = ? AND display_name = ?",
        ).get(gameId, displayName);
        if (taken) fail("conflict", "That name is already taken in this game.");
        const id = crypto.randomUUID();
        q(
            "INSERT INTO players (id, game_id, client_id, display_name, role, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, gameId, clientId, displayName, role, now());
        return id;
    }

    // ─── Games ───────────────────────────────────────────────

    function createGame(
        clientId: string,
        req: { displayName: string; role: PlayerRole },
    ): GameSessionResponse {
        return tx(db, () => {
            let roomCode = "";
            for (let attempt = 0; attempt < 10 && !roomCode; attempt++) {
                const candidate = randomCode(
                    ROOM_CODE_ALPHABET,
                    ROOM_CODE_LENGTH,
                );
                if (
                    !q("SELECT 1 FROM games WHERE room_code = ?").get(candidate)
                )
                    roomCode = candidate;
            }
            if (!roomCode)
                fail("internal", "Failed to generate a unique room code");

            const gameId = crypto.randomUUID();
            const created = now();
            q(
                "INSERT INTO games (id, room_code, phase, version, created_at, expires_at) VALUES (?, ?, 'setup', 1, ?, ?)",
            ).run(gameId, roomCode, created, created + options.gameTtlMs);
            q("INSERT INTO game_geo (game_id) VALUES (?)").run(gameId);
            const playerId = insertPlayer(
                gameId,
                clientId,
                req.displayName,
                req.role,
            );
            q("UPDATE games SET host_player_id = ? WHERE id = ?").run(
                playerId,
                gameId,
            );
            return { gameId, roomCode, playerId, phase: "setup" as const };
        });
    }

    function joinGame(
        clientId: string,
        req: { roomCode: string; displayName: string; role: PlayerRole },
    ): GameSessionResponse {
        const game = getGameByCode(req.roomCode);
        if (!game)
            fail(
                "not_found",
                "Game not found. Check the room code and try again.",
            );
        const existing = getPlayerForClient(game!.id, clientId);
        if (existing) {
            return {
                gameId: game!.id,
                roomCode: game!.room_code,
                playerId: existing.id,
                phase: game!.phase,
                alreadyJoined: true,
            };
        }
        if (game!.phase !== "setup")
            fail("conflict", "This game has already started.");
        let playerId = "";
        mutate(game!.id, () => {
            playerId = insertPlayer(
                game!.id,
                clientId,
                req.displayName,
                req.role,
            );
        });
        return {
            gameId: game!.id,
            roomCode: game!.room_code,
            playerId,
            phase: game!.phase,
            alreadyJoined: false,
        };
    }

    function rejoin(
        clientId: string | null,
        roomCode: string,
    ): GameSessionResponse {
        const game =
            getGameByCode(roomCode) ?? fail("not_found", "Game not found");
        const player = getPlayerForClient(game.id, clientId);
        if (!player) fail("forbidden", "You are not a player in this game");
        return {
            gameId: game.id,
            roomCode: game.room_code,
            playerId: player!.id,
            phase: game.phase,
        };
    }

    function getState(clientId: string | null, gameId: string): GameState {
        const { game, player } = access(clientId, gameId, "read");

        const players = (
            q(
                "SELECT * FROM players WHERE game_id = ? ORDER BY joined_at, rowid",
            ).all(gameId) as unknown as PlayerRow[]
        ).map((p) => ({
            id: p.id,
            displayName: p.display_name,
            role: p.role,
            joinedAt: iso(p.joined_at),
        }));

        const answers = new Map<string, CommittedQuestionDTO["answer"]>();
        for (const a of q("SELECT * FROM answers WHERE game_id = ?").all(
            gameId,
        ) as any[]) {
            answers.set(a.question_id, {
                id: a.id,
                answeredBy: a.answered_by,
                data: JSON.parse(a.data),
                answeredAt: iso(a.answered_at),
                undoDeadline: iso(a.undo_deadline),
            });
        }
        const vetoes = new Map<string, CommittedQuestionDTO["veto"]>();
        for (const v of q(
            "SELECT * FROM question_vetoes WHERE game_id = ?",
        ).all(gameId) as any[]) {
            vetoes.set(v.question_id, {
                id: v.id,
                vetoedBy: v.vetoed_by,
                reason: v.reason,
                createdAt: iso(v.created_at),
            });
        }
        const questions = (
            q("SELECT * FROM questions WHERE game_id = ? ORDER BY seq").all(
                gameId,
            ) as any[]
        ).map(
            (row): CommittedQuestionDTO => ({
                id: row.id,
                order: row.seq,
                askedBy: row.asked_by,
                type: row.type,
                data: JSON.parse(row.data),
                createdAt: iso(row.created_at),
                answer: answers.get(row.id) ?? null,
                veto: vetoes.get(row.id) ?? null,
            }),
        );

        const state: GameState = {
            version: game.version,
            geoVersions: geoVersions(gameId),
            game: {
                id: game.id,
                roomCode: game.room_code,
                phase: game.phase,
                hostPlayerId: game.host_player_id,
                createdAt: iso(game.created_at),
                expiresAt: iso(game.expires_at),
                settings: {
                    hidingRadius: game.hiding_radius,
                    hidingRadiusUnits: game.hiding_radius_units,
                    displayHidingZonesOptions: parseJson(
                        game.display_hiding_zones_options,
                    ),
                },
            },
            players,
            questions,
            you: {
                playerId: player.id,
                role: player.role,
                isHost: game.host_player_id === player.id,
            },
        };

        if (player.role === "hider") {
            const loc = q(
                "SELECT lat, lng, updated_at FROM hider_location WHERE game_id = ?",
            ).get(gameId) as
                | { lat: number; lng: number; updated_at: number }
                | undefined;
            state.hiderLocation = loc
                ? { lat: loc.lat, lng: loc.lng, updatedAt: iso(loc.updated_at) }
                : null;
        }
        return state;
    }

    function getGeo(clientId: string | null, gameId: string): GeoData {
        access(clientId, gameId, "read");
        const row = q(
            "SELECT map_geo_location, poly_geo_json, custom_stations, permanent_overlay FROM game_geo WHERE game_id = ?",
        ).get(gameId) as Record<string, string | null> | undefined;
        return {
            mapGeoLocation: parseJson(row?.map_geo_location ?? null),
            polyGeoJSON: parseJson(row?.poly_geo_json ?? null),
            customStations: parseJson(row?.custom_stations ?? null),
            permanentOverlay: parseJson(row?.permanent_overlay ?? null),
        };
    }

    function getGeoField(
        clientId: string | null,
        gameId: string,
        field: GeoField,
    ) {
        access(clientId, gameId, "read");
        const col = GEO_COLUMNS[field].data;
        const row = q(
            `SELECT ${col} AS value FROM game_geo WHERE game_id = ?`,
        ).get(gameId) as { value: string | null } | undefined;
        return { value: parseJson(row?.value ?? null) };
    }

    function leave(clientId: string | null, gameId: string) {
        const { game, player } = access(clientId, gameId, "leave");
        let deleted = false;
        tx(db, () => {
            q("DELETE FROM players WHERE id = ?").run(player.id);
            const next = q(
                "SELECT id FROM players WHERE game_id = ? ORDER BY joined_at, rowid LIMIT 1",
            ).get(gameId) as { id: string } | undefined;
            if (!next) {
                q("DELETE FROM games WHERE id = ?").run(gameId);
                deleted = true;
                return;
            }
            if (game.host_player_id === player.id) {
                q("UPDATE games SET host_player_id = ? WHERE id = ?").run(
                    next.id,
                    gameId,
                );
            }
            bump(gameId);
        });
        options.onPlayerRemoved?.(gameId, player.id);
        if (deleted) options.onGameDeleted?.(gameId);
        else options.onChange?.(gameId, stateEvent(gameId));
    }

    function setPhase(
        clientId: string | null,
        gameId: string,
        action: "start" | "end",
    ) {
        access(clientId, gameId, action);
        return mutate(gameId, () => {
            q("UPDATE games SET phase = ? WHERE id = ?").run(
                action === "start" ? "playing" : "ended",
                gameId,
            );
        });
    }

    function updateSettings(
        clientId: string | null,
        gameId: string,
        req: UpdateSettingsRequest,
    ) {
        access(clientId, gameId, "updateSettings");
        return mutate(gameId, () => {
            if (req.hidingRadius !== undefined)
                q("UPDATE games SET hiding_radius = ? WHERE id = ?").run(
                    req.hidingRadius,
                    gameId,
                );
            if (req.hidingRadiusUnits !== undefined)
                q("UPDATE games SET hiding_radius_units = ? WHERE id = ?").run(
                    req.hidingRadiusUnits,
                    gameId,
                );
            if (req.displayHidingZonesOptions !== undefined)
                q(
                    "UPDATE games SET display_hiding_zones_options = ? WHERE id = ?",
                ).run(
                    req.displayHidingZonesOptions === null
                        ? null
                        : JSON.stringify(req.displayHidingZonesOptions),
                    gameId,
                );
        });
    }

    function putGeo(
        clientId: string | null,
        gameId: string,
        field: GeoField,
        value: unknown,
    ) {
        access(clientId, gameId, "updateGeo");
        const cols = GEO_COLUMNS[field];
        return mutate(gameId, () => {
            const version = (
                q("SELECT version FROM games WHERE id = ?").get(gameId) as {
                    version: number;
                }
            ).version;
            q(
                `UPDATE game_geo SET ${cols.data} = ?, ${cols.version} = ? WHERE game_id = ?`,
            ).run(
                value === null || value === undefined
                    ? null
                    : JSON.stringify(value),
                version + 1,
                gameId,
            );
        });
    }

    function putHiderLocation(
        clientId: string | null,
        gameId: string,
        loc: { lat: number; lng: number },
    ) {
        const { player } = access(clientId, gameId, "setHiderLocation");
        return mutate(gameId, () => {
            q(
                `INSERT INTO hider_location (game_id, lat, lng, set_by, updated_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(game_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
                 set_by = excluded.set_by, updated_at = excluded.updated_at`,
            ).run(gameId, loc.lat, loc.lng, player.id, now());
        });
    }

    // ─── Questions ───────────────────────────────────────────

    function askQuestion(
        clientId: string | null,
        gameId: string,
        req: { type: string; data: Record<string, unknown> },
    ) {
        const { player } = access(clientId, gameId, "askQuestion");
        const data = { ...req.data };
        for (const key of LOCAL_QUESTION_KEYS) delete data[key];
        return mutate(gameId, () => {
            const id = crypto.randomUUID();
            const { next } = q(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM questions WHERE game_id = ?",
            ).get(gameId) as { next: number };
            q(
                "INSERT INTO questions (id, game_id, seq, asked_by, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ).run(
                id,
                gameId,
                next,
                player.id,
                req.type,
                JSON.stringify(data),
                now(),
            );
            return id;
        });
    }

    const questionGame = (questionId: string) => {
        const row = q("SELECT game_id FROM questions WHERE id = ?").get(
            questionId,
        ) as { game_id: string } | undefined;
        return row?.game_id ?? fail("not_found", "Question not found");
    };

    const assertUnresolved = (questionId: string) => {
        if (q("SELECT 1 FROM answers WHERE question_id = ?").get(questionId))
            fail("conflict", "This question has already been answered");
        if (
            q("SELECT 1 FROM question_vetoes WHERE question_id = ?").get(
                questionId,
            )
        )
            fail("conflict", "This question has been vetoed");
    };

    function answer(
        clientId: string | null,
        questionId: string,
        data: Record<string, unknown>,
    ) {
        const gameId = questionGame(questionId);
        const { player } = access(clientId, gameId, "answer");
        return mutate(gameId, () => {
            assertUnresolved(questionId);
            const id = crypto.randomUUID();
            q(
                "INSERT INTO answers (id, question_id, game_id, answered_by, data, answered_at, undo_deadline) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ).run(
                id,
                questionId,
                gameId,
                player.id,
                JSON.stringify(data),
                now(),
                now() + UNDO_WINDOW_MS,
            );
            return id;
        });
    }

    function undoAnswer(clientId: string | null, answerId: string) {
        const row = q(
            "SELECT game_id, answered_by, undo_deadline FROM answers WHERE id = ?",
        ).get(answerId) as
            | {
                  game_id: string;
                  answered_by: string | null;
                  undo_deadline: number;
              }
            | undefined;
        if (!row) fail("not_found", "Answer not found");
        access(clientId, row!.game_id, "undoAnswer", {
            ownerPlayerId: row!.answered_by,
            undoDeadline: row!.undo_deadline,
        });
        return mutate(row!.game_id, () => {
            q("DELETE FROM answers WHERE id = ?").run(answerId);
        });
    }

    function veto(
        clientId: string | null,
        questionId: string,
        reason: string | null,
    ) {
        const gameId = questionGame(questionId);
        const { player } = access(clientId, gameId, "veto");
        return mutate(gameId, () => {
            assertUnresolved(questionId);
            const id = crypto.randomUUID();
            q(
                "INSERT INTO question_vetoes (id, question_id, game_id, vetoed_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(id, questionId, gameId, player.id, reason, now());
            return id;
        });
    }

    function unveto(clientId: string | null, vetoId: string) {
        const row = q(
            "SELECT game_id, vetoed_by FROM question_vetoes WHERE id = ?",
        ).get(vetoId) as
            | { game_id: string; vetoed_by: string | null }
            | undefined;
        if (!row) fail("not_found", "Veto not found");
        access(clientId, row!.game_id, "unveto", {
            ownerPlayerId: row!.vetoed_by,
        });
        return mutate(row!.game_id, () => {
            q("DELETE FROM question_vetoes WHERE id = ?").run(vetoId);
        });
    }

    // ─── SSE support ─────────────────────────────────────────

    function subscribeInfo(clientId: string | null, gameId: string) {
        const { player } = access(clientId, gameId, "read");
        return { playerId: player.id, event: stateEvent(gameId) };
    }

    // ─── Shares ──────────────────────────────────────────────

    function createShare(data: string) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const id = randomCode(SHARE_ALPHABET, 10);
            try {
                q(
                    "INSERT INTO shares (id, data, created_at, expires_at) VALUES (?, ?, ?, ?)",
                ).run(id, data, now(), now() + options.shareTtlMs);
                return { id };
            } catch (error: any) {
                if (!String(error?.message).includes("UNIQUE")) throw error;
            }
        }
        return fail("internal", "Failed to create share");
    }

    function getShare(id: string) {
        const row = q(
            "SELECT data FROM shares WHERE id = ? AND expires_at > ?",
        ).get(id, now()) as { data: string } | undefined;
        return row ?? fail("not_found", "Share not found or expired");
    }

    // ─── Maintenance ─────────────────────────────────────────

    function cleanup() {
        const t = now();
        const expired = q("SELECT id FROM games WHERE expires_at <= ?").all(
            t,
        ) as { id: string }[];
        tx(db, () => {
            q("DELETE FROM games WHERE expires_at <= ?").run(t);
            q("DELETE FROM shares WHERE expires_at <= ?").run(t);
            q(
                "DELETE FROM clients WHERE last_seen_at <= ? AND NOT EXISTS (SELECT 1 FROM players p WHERE p.client_id = clients.id)",
            ).run(t - 400 * 24 * 60 * 60 * 1000);
        });
        for (const { id } of expired) options.onGameDeleted?.(id);
        return { expiredGames: expired.length };
    }

    function health() {
        q("SELECT 1").get();
    }

    return {
        findClient,
        ensureClient,
        createGame,
        joinGame: (
            clientId: string,
            req: { roomCode: string; displayName: string; role: PlayerRole },
        ) => joinGame(clientId, req),
        rejoin,
        getState,
        getGeo,
        getGeoField,
        leave,
        start: (clientId: string | null, gameId: string) =>
            setPhase(clientId, gameId, "start"),
        end: (clientId: string | null, gameId: string) =>
            setPhase(clientId, gameId, "end"),
        updateSettings,
        putGeo,
        putHiderLocation,
        askQuestion,
        answer,
        undoAnswer,
        veto,
        unveto,
        subscribeInfo,
        createShare,
        getShare,
        cleanup,
        health,
    };
}
