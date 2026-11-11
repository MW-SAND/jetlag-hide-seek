/**
 * Base map styles. CARTO started requiring an API key (Nov 2026) and the
 * OpenStreetMap tile servers block app traffic, so the defaults are Esri's
 * keyless raster basemaps. Thunderforest styles need the user's own key.
 */
export type BaseTileLayer =
    | "streets"
    | "light"
    | "dark"
    | "satellite"
    | "transport"
    | "neighbourhood"
    | "osmcarto";

export interface TileStyle {
    id: BaseTileLayer;
    label: string;
    url: (apiKey: string) => string;
    attribution: string;
    maxNativeZoom: number;
    /** Optional label overlay drawn above the base tiles. */
    overlayUrl?: string;
    needsApiKey?: boolean;
    preview: string;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTRIBUTION =
    'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TF_ATTRIBUTION =
    '&copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const TILE_STYLES: TileStyle[] = [
    {
        id: "streets",
        label: "Streets",
        url: () => `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTRIBUTION,
        maxNativeZoom: 19,
        preview: "#e8e2d4",
    },
    {
        id: "light",
        label: "Light",
        url: () =>
            `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        overlayUrl: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTRIBUTION,
        maxNativeZoom: 16,
        preview: "#e5e5e5",
    },
    {
        id: "dark",
        label: "Dark",
        url: () =>
            `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        overlayUrl: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTRIBUTION,
        maxNativeZoom: 16,
        preview: "#2b2b2b",
    },
    {
        id: "satellite",
        label: "Satellite",
        url: () => `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
        overlayUrl: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
        attribution: ESRI_ATTRIBUTION,
        maxNativeZoom: 19,
        preview: "#3b4a35",
    },
    {
        id: "transport",
        label: "Transit (key)",
        url: (key) =>
            `https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${key}`,
        attribution: TF_ATTRIBUTION,
        maxNativeZoom: 22,
        needsApiKey: true,
        preview: "#dfe7ee",
    },
    {
        id: "neighbourhood",
        label: "Neighbourhood (key)",
        url: (key) =>
            `https://tile.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=${key}`,
        attribution: TF_ATTRIBUTION,
        maxNativeZoom: 22,
        needsApiKey: true,
        preview: "#efe9e1",
    },
    {
        id: "osmcarto",
        label: "OpenStreetMap",
        url: () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxNativeZoom: 19,
        preview: "#f2efe9",
    },
];

export const DEFAULT_TILE_STYLE: BaseTileLayer = "streets";

/** Resolve a stored value (including legacy CARTO ids) to a usable style. */
export function resolveTileStyle(id: string, apiKey: string): TileStyle {
    const style = TILE_STYLES.find((s) => s.id === id);
    if (!style || (style.needsApiKey && !apiKey)) {
        return TILE_STYLES.find((s) => s.id === DEFAULT_TILE_STYLE)!;
    }
    return style;
}
