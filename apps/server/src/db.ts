import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations. Each entry is applied once, in order, inside a single
 * transaction together with its `PRAGMA user_version` bump.
 *
 * The DDL must stay readable by sqlite3 3.22 (Ubuntu 18.04 host, used by the
 * homeserver backup scripts): no STRICT tables, no generated columns, no
 * RETURNING, no JSON functions in constraints or indexes.
 */
export const MIGRATIONS: string[] = [
    `
    CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE games (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL UNIQUE,
        phase TEXT NOT NULL DEFAULT 'setup'
            CHECK (phase IN ('setup', 'playing', 'ended')),
        host_player_id TEXT,
        hiding_radius REAL,
        hiding_radius_units TEXT,
        display_hiding_zones_options TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX idx_games_expires_at ON games(expires_at);

    CREATE TABLE game_geo (
        game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
        map_geo_location TEXT,
        poly_geo_json TEXT,
        custom_stations TEXT,
        permanent_overlay TEXT,
        v_map_geo_location INTEGER NOT NULL DEFAULT 0,
        v_poly_geo_json INTEGER NOT NULL DEFAULT 0,
        v_custom_stations INTEGER NOT NULL DEFAULT 0,
        v_permanent_overlay INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE players (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('hider', 'seeker')),
        joined_at INTEGER NOT NULL,
        UNIQUE (game_id, display_name),
        UNIQUE (game_id, client_id)
    );
    CREATE INDEX idx_players_game_id ON players(game_id);
    CREATE INDEX idx_players_client_id ON players(client_id);

    CREATE TABLE hider_location (
        game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        set_by TEXT REFERENCES players(id) ON DELETE SET NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        asked_by TEXT REFERENCES players(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (game_id, seq)
    );
    CREATE INDEX idx_questions_game_id ON questions(game_id);

    CREATE TABLE answers (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        answered_by TEXT REFERENCES players(id) ON DELETE SET NULL,
        data TEXT NOT NULL,
        answered_at INTEGER NOT NULL,
        undo_deadline INTEGER NOT NULL
    );
    CREATE INDEX idx_answers_game_id ON answers(game_id);

    CREATE TABLE question_vetoes (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        vetoed_by TEXT REFERENCES players(id) ON DELETE SET NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_question_vetoes_game_id ON question_vetoes(game_id);

    CREATE TABLE shares (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX idx_shares_expires_at ON shares(expires_at);
    `,
];

export const DB_FILE = "jetlag.db";

export function openDatabase(dataDir: string): DatabaseSync {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, DB_FILE));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    return db;
}

export function userVersion(db: DatabaseSync): number {
    const row = db.prepare("PRAGMA user_version").get() as {
        user_version: number;
    };
    return row.user_version;
}

export function migrate(db: DatabaseSync) {
    let current = userVersion(db);
    while (current < MIGRATIONS.length) {
        const next = current + 1;
        db.exec("BEGIN IMMEDIATE");
        try {
            db.exec(MIGRATIONS[current]);
            db.exec(`PRAGMA user_version = ${next}`);
            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
        current = next;
    }
}

export function closeDatabase(db: DatabaseSync) {
    try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
        db.close();
    }
}

/** Run `fn` inside a write transaction. node:sqlite is synchronous, so no interleaving. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
