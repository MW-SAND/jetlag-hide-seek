/** Small local preferences that make returning players faster. */
const NAME_KEY = "jl:displayName";

export function loadRememberedName(): string {
    try {
        return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
        return "";
    }
}

export function rememberName(name: string) {
    try {
        localStorage.setItem(NAME_KEY, name);
    } catch {
        /* private mode: ignore */
    }
}

/** Shareable invite link for a room (opens the join form pre-filled). */
export function inviteLink(roomCode: string) {
    return `${window.location.origin}/#game/${roomCode}`;
}

// Rooms this browser is a player in, so a refresh can reconnect without asking
// (and new invitees don't probe a room they were never part of).
const ROOMS_KEY = "jl:rooms";

function readRooms(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? "[]");
        return Array.isArray(parsed)
            ? parsed.filter((c) => typeof c === "string")
            : [];
    } catch {
        return [];
    }
}

function writeRooms(rooms: string[]) {
    try {
        localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms.slice(-10)));
    } catch {
        /* private mode: ignore */
    }
}

export function isKnownRoom(roomCode: string) {
    return readRooms().includes(roomCode.toUpperCase());
}

export function rememberRoom(roomCode: string) {
    const code = roomCode.toUpperCase();
    writeRooms([...readRooms().filter((c) => c !== code), code]);
}

export function forgetRoom(roomCode: string) {
    const code = roomCode.toUpperCase();
    writeRooms(readRooms().filter((c) => c !== code));
}
