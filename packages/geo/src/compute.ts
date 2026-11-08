/**
 * The question → eliminated-area pipeline, independent of React/Leaflet so it
 * can run inside a Web Worker (or on the main thread as a fallback).
 */
import * as turf from "@turf/turf";
import type { FeatureCollection } from "geojson";

import { clearCache, determineMapBoundaries } from "./api";
import {
    ComputeCancelled,
    type ComputeRequest,
    type ComputeResult,
    errorCount,
} from "./compute-types";
import { applyGeoEnv, mapGeoJSON } from "./env";
import { holedMask } from "./geo-utils";
import {
    adjustMapGeoDataForQuestion,
    determinePlanningPolygon,
    hiderifyQuestion,
} from "./index";

export * from "./compute-types";

// FNV-1a; good enough to key a small memo cache.
const hash = (input: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + ":" + input.length.toString(36);
};

const MEMO_LIMIT = 24;
const memo = new Map<string, any>();
const remember = (key: string, value: any) => {
    memo.delete(key);
    memo.set(key, value);
    while (memo.size > MEMO_LIMIT) {
        memo.delete(memo.keys().next().value!);
    }
};

export const clearComputeMemo = () => memo.clear();

const stripUiState = (data: any) => {
    // collapsed only affects the sidebar, never the geometry.
    const { collapsed: _c, ...rest } = data ?? {};
    return rest;
};

export async function computeMap(
    request: ComputeRequest,
    isCancelled: () => boolean = () => false,
): Promise<ComputeResult> {
    const { questions, env, planningModeEnabled } = request;
    const check = () => {
        if (isCancelled()) throw new ComputeCancelled();
    };

    applyGeoEnv(env);

    if (questions.length === 0) {
        try {
            await clearCache();
        } catch (error) {
            console.warn("Failed to clear map cache:", error);
        }
    }

    let mapGeoData: any = env.mapGeoJSON ?? env.polyGeoJSON;
    if (!mapGeoData) {
        mapGeoData = await determineMapBoundaries();
    }
    check();
    mapGeoJSON.set(mapGeoData);
    const baseMapGeoJSON = mapGeoData;

    let hiderifiedQuestions: ComputeResult["hiderifiedQuestions"] = null;
    if (env.hiderMode !== false) {
        for (const question of questions) {
            await hiderifyQuestion(question);
            check();
        }
        hiderifiedQuestions = questions.map((q) => ({
            key: q.key,
            data: q.data,
        }));
    }

    const planningPolygons: ComputeResult["planningPolygons"] = [];

    // Everything except the evolving area and the questions themselves.
    let chainKey = hash(
        JSON.stringify([
            baseMapGeoJSON,
            env.mapGeoLocation,
            env.polyGeoJSON ? 1 : 0,
            env.additionalMapGeoLocations,
            env.hiderMode,
            env.trainStations.length,
            env.trainStations.length
                ? hash(JSON.stringify(env.trainStations))
                : "",
            planningModeEnabled,
        ]),
    );

    for (const question of questions) {
        const planningPolygon = await determinePlanningPolygon(
            question,
            planningModeEnabled,
        );
        if (planningPolygon) {
            planningPolygons.push({
                key: question.key,
                polygon: planningPolygon,
            });
        }
        check();

        if (planningModeEnabled && question.data.drag) continue;

        chainKey = hash(
            chainKey +
                "|" +
                question.id +
                JSON.stringify(stripUiState(question.data)),
        );
        const cached = memo.get(chainKey);
        if (cached) {
            mapGeoData = cached;
            continue;
        }

        const errorsBefore = errorCount();
        mapGeoData = await adjustMapGeoDataForQuestion(question, mapGeoData);
        check();

        if (mapGeoData.type !== "FeatureCollection") {
            mapGeoData = { type: "FeatureCollection", features: [mapGeoData] };
        }
        if (errorCount() === errorsBefore) remember(chainKey, mapGeoData);
    }

    const masked: FeatureCollection = {
        type: "FeatureCollection",
        features: [holedMask(mapGeoData)!],
    };
    const eliminationMask = turf.simplify(masked, {
        tolerance: 0.001,
        highQuality: false,
    });

    let bbox: ComputeResult["bbox"] = null;
    try {
        const remaining = holedMask(eliminationMask as any);
        if (remaining) bbox = turf.bbox(remaining) as ComputeResult["bbox"];
    } catch {
        bbox = null;
    }

    return {
        baseMapGeoJSON,
        hiderifiedQuestions,
        planningPolygons,
        eliminationMask,
        bbox,
    };
}
