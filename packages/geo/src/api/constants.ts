import type { APILocations } from "../schema";

/** Same-origin caching proxy (apps/server/src/overpass.ts). */
export const OVERPASS_API = "/api/overpass";
/** Last resort if our own server can't reach any Overpass mirror. */
export const OVERPASS_API_FALLBACK = "https://overpass-api.de/api/interpreter";
/** Longer GET URLs risk being rejected by reverse proxies; POST those. */
export const OVERPASS_MAX_GET_URL = 6000;
export const GEOCODER_API = "https://photon.komoot.io/api/";

export const ICON_COLORS = {
    black: "#3D3D3D",
    blue: "#2A81CB",
    gold: "#FFD326",
    green: "#2AAD27",
    grey: "#7B7B7B",
    orange: "#CB8427",
    red: "#CB2B3E",
    violet: "#9C2BCB",
};

export const LOCATION_FIRST_TAG: {
    [key in APILocations]:
        | "amenity"
        | "tourism"
        | "leisure"
        | "diplomatic"
        | "natural";
} = {
    aquarium: "tourism",
    hospital: "amenity",
    peak: "natural",
    museum: "tourism",
    theme_park: "tourism",
    zoo: "tourism",
    cinema: "amenity",
    library: "amenity",
    golf_course: "leisure",
    consulate: "diplomatic",
    park: "leisure",
};

export const BLANK_GEOJSON = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [-180, -90],
                        [180, -90],
                        [180, 90],
                        [-180, 90],
                        [-180, -90],
                    ],
                ],
            },
        },
    ],
};
