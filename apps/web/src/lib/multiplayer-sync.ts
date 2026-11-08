/**
 * Multiplayer sync of the local map state.
 *
 * Bridges local nanostores (context.ts) ↔ server while a game is shown:
 * - the host owns game settings + geo data and pushes local edits;
 * - hiders push the hider location;
 * - everyone applies remote values when the server's versions move.
 *
 * Rules that fix the old Supabase sync:
 * - nothing is pushed before the first server state is reconciled, so stale
 *   localStorage values never overwrite the server on entry;
 * - echo suppression is per key, and a key with a pending local write never
 *   gets overwritten by an older remote value;
 * - pending debounced writes are flushed before leaving.
 */
import type { GameState, GeoField } from "@jetlag/shared";
import { GEO_FIELDS } from "@jetlag/shared";
import type { ReadableAtom, WritableAtom } from "nanostores";

import { api } from "./api";
import {
    customStations,
    displayHidingZonesOptions,
    hiderMode,
    hidingRadius,
    hidingRadiusUnits,
    mapGeoJSON,
    mapGeoLocation,
    permanentOverlay,
    polyGeoJSON,
    questions,
} from "./context";
import { gameSession, gameState } from "./game-store";
import { registerBeforeLeave } from "./multiplayer";
import {
    answerDraftSelections,
    applyAnswerToQuestionData,
} from "./question-store";

export type { RealtimeStatus } from "./game-store";
export { realtimeStatus } from "./game-store";

export function stableStringify(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

const stripLocalQuestionMeta = (data: Record<string, unknown>) => {
    const { drag: _drag, collapsed: _collapsed, _dbId, ...rest } = data;
    return rest;
};

const GEO_STORES: Record<GeoField, WritableAtom<any>> = {
    mapGeoLocation,
    polyGeoJSON,
    customStations,
    permanentOverlay,
};

type SettingsKey =
    | "hidingRadius"
    | "hidingRadiusUnits"
    | "displayHidingZonesOptions";
const SETTINGS_STORES: Record<SettingsKey, WritableAtom<any>> = {
    hidingRadius,
    hidingRadiusUnits,
    displayHidingZonesOptions,
};

interface Pending {
    timer: ReturnType<typeof setTimeout> | null;
    run: () => Promise<void>;
}

interface ActiveSync {
    gameId: string;
    initialized: boolean;
    geoVersions: Partial<Record<GeoField, number>>;
    questionsSignature: string | null;
    unsubscribers: (() => void)[];
}

let active: ActiveSync | null = null;
/** Last value known to be on the server, per key. */
const synced = new Map<string, string>();
const pending = new Map<string, Pending>();
const inflight = new Map<string, Promise<void>>();
let applyingRemote = 0;

const isBusy = (key: string) => pending.has(key) || inflight.has(key);

function setFromRemote<T>(key: string, store: WritableAtom<T>, value: T) {
    const serialized = stableStringify(value);
    synced.set(key, serialized);
    if (isBusy(key)) return; // our newer local edit wins
    if (stableStringify(store.get()) === serialized) return;
    applyingRemote++;
    try {
        store.set(value);
    } finally {
        applyingRemote--;
    }
}

function schedule(
    key: string,
    value: unknown,
    send: () => Promise<unknown>,
    delay: number,
) {
    if (!active?.initialized || applyingRemote > 0) return;
    const serialized = stableStringify(value);
    if (synced.get(key) === serialized) {
        const existing = pending.get(key);
        if (existing?.timer) clearTimeout(existing.timer);
        pending.delete(key);
        return;
    }
    const existing = pending.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    const entry: Pending = {
        timer: null,
        run: async () => {
            pending.delete(key);
            const previous = inflight.get(key);
            const job = (async () => {
                await previous;
                try {
                    await send();
                    synced.set(key, serialized);
                } catch (error) {
                    console.error(`[sync] push ${key} failed:`, error);
                }
            })();
            inflight.set(key, job);
            await job;
            if (inflight.get(key) === job) inflight.delete(key);
        },
    };
    entry.timer = setTimeout(() => void entry.run(), delay);
    pending.set(key, entry);
}

/** Send all debounced writes now. */
export async function flushPendingWrites() {
    const entries = [...pending.values()];
    for (const entry of entries) if (entry.timer) clearTimeout(entry.timer);
    await Promise.allSettled(entries.map((entry) => entry.run()));
    await Promise.allSettled([...inflight.values()]);
}

// ─── Remote → local ──────────────────────────────────────────

async function reconcileGeo(sync: ActiveSync, state: GameState) {
    const amHost = state.you.isHost;
    for (const field of GEO_FIELDS) {
        const version = state.geoVersions[field];
        if (sync.geoVersions[field] === version) continue;
        sync.geoVersions[field] = version;
        const key = `geo:${field}`;
        const store = GEO_STORES[field];

        if (version === 0) {
            // Never set on the server: the host seeds it with its local value.
            if (amHost && !sync.initialized)
                pushGeo(sync.gameId, field, store.get(), true);
            continue;
        }
        if (amHost && isBusy(key)) continue;
        try {
            const { value } = await api.geoField(sync.gameId, field);
            if (active !== sync) return;
            if (value === null || value === undefined) {
                synced.set(key, stableStringify(value));
                continue;
            }
            const before = stableStringify(store.get());
            setFromRemote(key, store, value);
            if (
                (field === "mapGeoLocation" || field === "polyGeoJSON") &&
                stableStringify(store.get()) !== before
            ) {
                // The playable area changed: recompute it.
                mapGeoJSON.set(null);
            }
        } catch (error) {
            console.warn(`[sync] failed to load ${field}`, error);
        }
    }
}

function reconcileSettings(sync: ActiveSync, state: GameState) {
    const settings = state.game.settings;
    for (const key of Object.keys(SETTINGS_STORES) as SettingsKey[]) {
        const store = SETTINGS_STORES[key];
        const remote = settings[key];
        if (remote === null || remote === undefined) {
            if (state.you.isHost && !sync.initialized)
                pushSetting(sync.gameId, key, store.get(), true);
            continue;
        }
        setFromRemote(`settings:${key}`, store, remote);
    }
}

function reconcileHiderLocation(sync: ActiveSync, state: GameState) {
    if (state.you.role !== "hider") return;
    const loc = state.hiderLocation;
    if (loc) {
        setFromRemote("hiderLocation", hiderMode, {
            latitude: loc.lat,
            longitude: loc.lng,
        });
        return;
    }
    if (sync.initialized) return;
    let current = hiderMode.get();
    if (current === false) {
        // No saved location yet — default to the map centre so the hider pin
        // appears immediately. mapGeoLocation stores [lat, lng] (Leaflet order).
        const [latitude, longitude] = mapGeoLocation.get().geometry.coordinates;
        current = { latitude, longitude };
        applyingRemote++;
        try {
            hiderMode.set(current);
        } finally {
            applyingRemote--;
        }
    }
    pushHiderLocation(sync.gameId, current, true);
}

function reconcileQuestions(sync: ActiveSync, state: GameState) {
    const signature = stableStringify(state.questions);
    if (signature === sync.questionsSignature) return;
    sync.questionsSignature = signature;

    const role = state.you.role;
    const drafts = answerDraftSelections.get();

    const reconstructed = state.questions.map((q) => {
        const official = q.answer?.data;
        const draft = drafts[q.id] as unknown as
            | Record<string, unknown>
            | undefined;
        const effective = official ?? (role === "hider" ? draft : undefined);
        const data = effective
            ? applyAnswerToQuestionData(q.type, q.data, effective)
            : q.data;
        return {
            id: q.type,
            key: q.order,
            data: { ...data, drag: false, collapsed: true, _dbId: q.id },
        };
    });

    if (role === "seeker") {
        const committedSignatures = new Set(
            state.questions.map((q) => `${q.type}:${stableStringify(q.data)}`),
        );
        const localDrafts = questions.get().filter((q) => {
            if ((q.data as any)._dbId) return false;
            const signature = `${q.id}:${stableStringify(
                stripLocalQuestionMeta(
                    q.data as unknown as Record<string, unknown>,
                ),
            )}`;
            return !committedSignatures.has(signature);
        });
        // Keep local draft keys clear of the committed question keys.
        const maxKey = Math.max(0, ...state.questions.map((q) => q.order));
        const rekeyed = localDrafts.map((q, i) =>
            q.key <= maxKey ? { ...q, key: maxKey + 1 + i } : q,
        );
        questions.set([...rekeyed, ...(reconstructed as any)]);
    } else {
        questions.set(reconstructed as any);
    }
}

async function onState(sync: ActiveSync, state: GameState) {
    if (active !== sync || state.game.id !== sync.gameId) return;
    reconcileSettings(sync, state);
    reconcileHiderLocation(sync, state);
    reconcileQuestions(sync, state);
    const geo = reconcileGeo(sync, state);
    if (!sync.initialized) {
        await geo;
        if (active === sync) sync.initialized = true;
    }
}

// ─── Local → remote ──────────────────────────────────────────

function pushSetting(
    gameId: string,
    key: SettingsKey,
    value: unknown,
    force = false,
) {
    const run = () => api.updateSettings(gameId, { [key]: value } as any);
    if (force) {
        synced.delete(`settings:${key}`);
        void run().then(() =>
            synced.set(`settings:${key}`, stableStringify(value)),
        );
        return;
    }
    schedule(`settings:${key}`, value, run, 500);
}

function pushGeo(
    gameId: string,
    field: GeoField,
    value: unknown,
    force = false,
) {
    const run = async () => {
        const res = await api.putGeo(gameId, field, value ?? null);
        if (active?.gameId === gameId) active.geoVersions[field] = res.version;
    };
    if (force) {
        void run().then(() =>
            synced.set(`geo:${field}`, stableStringify(value)),
        );
        return;
    }
    schedule(`geo:${field}`, value, run, 1000);
}

function pushHiderLocation(
    gameId: string,
    value: { latitude: number; longitude: number },
    force = false,
) {
    const run = () =>
        api.putHiderLocation(gameId, value.latitude, value.longitude);
    if (force) {
        void run().then(() =>
            synced.set("hiderLocation", stableStringify(value)),
        );
        return;
    }
    schedule("hiderLocation", value, run, 500);
}

function watchLocalStores(sync: ActiveSync) {
    const amHost = () => gameState.get()?.you.isHost === true;
    const amHider = () => gameState.get()?.you.role === "hider";
    const listen = <T>(store: ReadableAtom<T>, fn: (value: T) => void) => {
        // `listen` (unlike `subscribe`) does not fire with the current value.
        sync.unsubscribers.push(store.listen(fn));
    };

    for (const key of Object.keys(SETTINGS_STORES) as SettingsKey[]) {
        listen(SETTINGS_STORES[key], (value) => {
            if (amHost()) pushSetting(sync.gameId, key, value);
        });
    }
    for (const field of GEO_FIELDS) {
        listen(GEO_STORES[field], (value) => {
            if (amHost()) pushGeo(sync.gameId, field, value);
        });
    }
    listen(hiderMode, (value) => {
        if (value !== false && amHider()) pushHiderLocation(sync.gameId, value);
    });
}

// ─── Lifecycle ───────────────────────────────────────────────

let unregisterFlush: (() => void) | null = null;

export function enterGame(gameId: string) {
    if (active?.gameId === gameId) return;
    exitGame();
    synced.clear();
    const sync: ActiveSync = {
        gameId,
        initialized: false,
        geoVersions: {},
        questionsSignature: null,
        unsubscribers: [],
    };
    active = sync;
    watchLocalStores(sync);

    let queue = Promise.resolve();
    sync.unsubscribers.push(
        gameState.subscribe((state) => {
            if (!state) return;
            queue = queue
                .then(() => onState(sync, state))
                .catch((error) => {
                    console.error("[sync] apply failed", error);
                });
        }),
    );
    unregisterFlush = registerBeforeLeave(flushPendingWrites);
}

export function exitGame() {
    if (!active) return;
    void flushPendingWrites();
    active.unsubscribers.forEach((unsub) => unsub());
    active = null;
    unregisterFlush?.();
    unregisterFlush = null;
}

/** For tests/diagnostics. */
export const isSyncInitialized = () => active?.initialized ?? false;
export const currentSyncGameId = () =>
    active?.gameId ?? gameSession.get()?.gameId ?? null;
