/**
 * Sharing a map setup (area + questions + zone settings) as a link, and
 * loading such links. Old `?hz` / `?hzc` links keep working; long setups are
 * stored server-side as short `?s=<id>` links.
 */
import { questionsSchema } from "@jetlag/geo/schema";
import { toast } from "react-toastify";

import { createShare, fetchShare } from "./api";
import {
    additionalMapGeoLocations,
    alwaysUseShortLinks,
    customPresets,
    customStations,
    disabledStations,
    displayHidingZonesOptions,
    hidingRadius,
    hidingZone,
    includeDefaultStations,
    mapGeoJSON,
    mapGeoLocation,
    permanentOverlay,
    polyGeoJSON,
    questions,
    useCustomStations,
} from "./context";
import { gameSession } from "./game-store";
import { compress, decompress, shareOrFallback } from "./utils";

const HIDING_ZONE_URL_PARAM = "hz";
const HIDING_ZONE_COMPRESSED_URL_PARAM = "hzc";
const SHARE_URL_PARAM = "s";
const LEGACY_PASTEBIN_URL_PARAM = "pb";

const newId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Apply a shared hiding-zone JSON document to the local stores. */
export function loadHidingZone(hidingZoneJson: string) {
    try {
        const geojson = JSON.parse(hidingZoneJson);

        if (geojson.properties && geojson.properties.isHidingZone === true) {
            questions.set(
                questionsSchema.parse(geojson.properties.questions ?? []),
            );
            mapGeoLocation.set(geojson);
            mapGeoJSON.set(null);
            polyGeoJSON.set(null);
            additionalMapGeoLocations.set(geojson.alternateLocations ?? []);
        } else if (geojson.questions) {
            questions.set(questionsSchema.parse(geojson.questions));
            delete geojson.questions;
            mapGeoJSON.set(geojson);
            polyGeoJSON.set(geojson);
        } else {
            questions.set([]);
            mapGeoJSON.set(geojson);
            polyGeoJSON.set(geojson);
        }

        const incomingPresets = geojson.presets ?? geojson.properties?.presets;
        if (Array.isArray(incomingPresets)) {
            const normalized = (incomingPresets as any[])
                .filter((p) => p && p.data)
                .map((p) => ({
                    id: p.id ?? newId(),
                    name: p.name ?? "Imported preset",
                    type: p.type ?? "custom",
                    data: p.data,
                    createdAt: p.createdAt ?? new Date().toISOString(),
                }));
            if (normalized.length > 0) {
                customPresets.set(normalized);
                toast.info(`Imported ${normalized.length} preset(s)`);
            }
        }

        if (Array.isArray(geojson.disabledStations))
            disabledStations.set(geojson.disabledStations);
        if (typeof geojson.hidingRadius === "number")
            hidingRadius.set(geojson.hidingRadius);
        if (geojson.zoneOptions)
            displayHidingZonesOptions.set(geojson.zoneOptions ?? []);
        if (typeof geojson.useCustomStations === "boolean")
            useCustomStations.set(geojson.useCustomStations);
        if (Array.isArray(geojson.customStations))
            customStations.set(geojson.customStations);
        if (typeof geojson.includeDefaultStations === "boolean")
            includeDefaultStations.set(geojson.includeDefaultStations);
        permanentOverlay.set(geojson.permanentOverlay ?? null);

        toast.success(
            gameSession.get()
                ? "Map setup loaded"
                : "Shared map loaded. Create a game to play on it.",
            { autoClose: 4000, toastId: "shared-setup" },
        );
    } catch (e) {
        toast.error(`Invalid map setup: ${e}`);
    }
}

/** Build a share link for the current setup (short link when it's long). */
export async function buildShareUrl(): Promise<string> {
    const compressed = await compress(JSON.stringify(hidingZone.get()));
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const longUrl = `${baseUrl}?${HIDING_ZONE_COMPRESSED_URL_PARAM}=${compressed}`;
    if (!alwaysUseShortLinks.get() && longUrl.length <= 2000) return longUrl;
    const { id } = await createShare(compressed);
    return `${baseUrl}?${SHARE_URL_PARAM}=${id}`;
}

/** Share via the native share sheet, falling back to the clipboard. */
export async function shareMapSetup() {
    let url: string;
    try {
        url = await buildShareUrl();
    } catch (error: any) {
        toast.error(
            `Could not create a share link: ${error?.message ?? error}`,
        );
        return;
    }
    const result = await shareOrFallback(url);
    if (result === false) {
        window.prompt("Copy this link:", url);
    } else if (result === "clipboard") {
        toast.success("Share link copied", { autoClose: 2000 });
    }
}

/** Load a setup from `?hz`, `?hzc` or `?s` in the current URL (once). */
export function loadSharedSetupFromUrl() {
    const params = new URL(window.location.toString()).searchParams;
    const legacy = params.get(HIDING_ZONE_URL_PARAM);
    const compressedParam = params.get(HIDING_ZONE_COMPRESSED_URL_PARAM);
    const shareId = params.get(SHARE_URL_PARAM);
    const pastebinId = params.get(LEGACY_PASTEBIN_URL_PARAM);
    const clearParams = () =>
        window.history.replaceState(
            {},
            "",
            `${window.location.pathname}${window.location.hash}`,
        );

    if (legacy !== null) {
        try {
            loadHidingZone(atob(legacy));
        } catch (e) {
            toast.error(`Invalid shared link: ${e}`);
        }
        clearParams();
    } else if (compressedParam !== null) {
        decompress(compressedParam)
            .then(loadHidingZone)
            .catch((e) => toast.error(`Invalid shared link: ${e}`))
            .finally(clearParams);
    } else if (shareId !== null) {
        fetchShare(shareId)
            .then(({ data }) => decompress(data))
            .then(loadHidingZone)
            .catch((error) =>
                toast.error(
                    `Failed to load shared link: ${error?.message ?? error}`,
                ),
            )
            .finally(clearParams);
    } else if (pastebinId !== null) {
        toast.error(
            "Pastebin links are no longer supported. Ask for a new share link.",
        );
        clearParams();
    }
}
