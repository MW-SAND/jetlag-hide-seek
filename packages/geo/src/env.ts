/**
 * Runtime environment for the geo engine.
 *
 * The engine reads a handful of app-level values (selected area, hider
 * position, cached stations…). They live here as plain nanostores atoms so the
 * same code runs on the main thread (where the web app mirrors its persistent
 * stores into these atoms) and inside the geo Web Worker (where they are set
 * from the incoming compute request).
 */
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { atom } from "nanostores";

import type {
    AdditionalMapGeoLocations,
    OpenStreetMap,
    StationCircle,
} from "./api/types";
import type { Units } from "./schema";

export type HiderPosition = false | { latitude: number; longitude: number };

export const DEFAULT_MAP_GEO_LOCATION: OpenStreetMap = {
    geometry: {
        coordinates: [36.5748441, 139.2394179],
        type: "Point",
    },
    type: "Feature",
    properties: {
        osm_type: "R",
        osm_id: 382313,
        extent: [45.7112046, 122.7141754, 20.2145811, 154.205541],
        country: "Japan",
        osm_key: "place",
        countrycode: "JP",
        osm_value: "country",
        name: "Japan",
        type: "country",
    },
};

export const defaultUnit = atom<Units>("miles");
export const hiderMode = atom<HiderPosition>(false);
export const mapGeoLocation = atom<OpenStreetMap>(DEFAULT_MAP_GEO_LOCATION);
export const additionalMapGeoLocations = atom<AdditionalMapGeoLocations[]>([]);
export const polyGeoJSON = atom<FeatureCollection<
    Polygon | MultiPolygon
> | null>(null);
export const mapGeoJSON = atom<FeatureCollection<
    Polygon | MultiPolygon
> | null>(null);
export const trainStations = atom<StationCircle[]>([]);

export interface GeoEnvSnapshot {
    defaultUnit: Units;
    hiderMode: HiderPosition;
    mapGeoLocation: OpenStreetMap;
    additionalMapGeoLocations: AdditionalMapGeoLocations[];
    polyGeoJSON: FeatureCollection<Polygon | MultiPolygon> | null;
    mapGeoJSON: FeatureCollection<Polygon | MultiPolygon> | null;
    trainStations: StationCircle[];
}

export const snapshotGeoEnv = (): GeoEnvSnapshot => ({
    defaultUnit: defaultUnit.get(),
    hiderMode: hiderMode.get(),
    mapGeoLocation: mapGeoLocation.get(),
    additionalMapGeoLocations: additionalMapGeoLocations.get(),
    polyGeoJSON: polyGeoJSON.get(),
    mapGeoJSON: mapGeoJSON.get(),
    trainStations: trainStations.get(),
});

export const applyGeoEnv = (env: Partial<GeoEnvSnapshot>) => {
    if (env.defaultUnit !== undefined) defaultUnit.set(env.defaultUnit);
    if (env.hiderMode !== undefined) hiderMode.set(env.hiderMode);
    if (env.mapGeoLocation !== undefined)
        mapGeoLocation.set(env.mapGeoLocation);
    if (env.additionalMapGeoLocations !== undefined)
        additionalMapGeoLocations.set(env.additionalMapGeoLocations);
    if (env.polyGeoJSON !== undefined) polyGeoJSON.set(env.polyGeoJSON);
    if (env.mapGeoJSON !== undefined) mapGeoJSON.set(env.mapGeoJSON);
    if (env.trainStations !== undefined) trainStations.set(env.trainStations);
};

/**
 * User-facing notifications. Defaults to console output; the web app installs
 * react-toastify on the main thread and the worker forwards messages to it.
 */
export interface Notifier {
    error(message: string, options?: { toastId?: string }): void;
    promise<T>(promise: Promise<T>, messages: { pending?: string }): Promise<T>;
}

let notifier: Notifier = {
    error: (message) => console.error(message),
    promise: (promise) => promise,
};

export const setNotifier = (next: Notifier) => {
    notifier = next;
};

export const toast: Notifier = {
    error: (message, options) => notifier.error(message, options),
    promise: (promise, messages) => notifier.promise(promise, messages),
};
