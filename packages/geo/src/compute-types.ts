/** Light-weight pieces of the compute pipeline (safe to import anywhere). */
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import type { GeoEnvSnapshot, Notifier } from "./env";
import type { Questions } from "./schema";

export interface ComputeRequest {
    questions: Questions;
    env: GeoEnvSnapshot;
    planningModeEnabled: boolean;
}

export interface ComputeResult {
    /** Area the questions were applied to; the caller should store it. */
    baseMapGeoJSON: FeatureCollection<Polygon | MultiPolygon> | null;
    /** Question data after hiderification (only when hider mode is on). */
    hiderifiedQuestions: { key: number; data: unknown }[] | null;
    planningPolygons: {
        key: number;
        polygon: FeatureCollection | Feature;
    }[];
    /** Inverted, simplified mask of the remaining area (ready to draw). */
    eliminationMask: FeatureCollection;
    /** [minLng, minLat, maxLng, maxLat] of the remaining area. */
    bbox: [number, number, number, number] | null;
}

export class ComputeCancelled extends Error {
    constructor() {
        super("cancelled");
        this.name = "ComputeCancelled";
    }
}

/** Notification errors raised while a step ran; failed steps are not memoized. */
let errorsRaised = 0;
export const errorCount = () => errorsRaised;

/** Wraps a notifier so errors are counted for the compute memo cache. */
export const countingNotifier = (inner: Notifier): Notifier => ({
    error(message, options) {
        errorsRaised++;
        inner.error(message, options);
    },
    promise(promise, messages) {
        return inner.promise(promise, messages);
    },
});
