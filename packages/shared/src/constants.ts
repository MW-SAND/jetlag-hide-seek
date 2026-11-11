/** Limits and rules shared by the server (enforcement) and the web app (UX). */

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = new RegExp(
    `^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`,
);

export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 20;
export const VETO_REASON_MAX = 200;

/** Hiders may undo an answer within this window. */
export const UNDO_WINDOW_MS = 30_000;

export const GAME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SHARE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Max JSON request body (geo data such as drawn polygons can be large). */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Max size of a stored share payload (already compressed + base64url). */
export const MAX_SHARE_BYTES = 1024 * 1024;

export const SSE_HEARTBEAT_MS = 25_000;

export const CLIENT_COOKIE = "jl_client";

export const GEO_FIELDS = [
    "mapGeoLocation",
    "polyGeoJSON",
    "customStations",
    "permanentOverlay",
] as const;
