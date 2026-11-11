import * as turf from "@turf/turf";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { beforeEach, describe, expect, it } from "vitest";

import { clearComputeMemo, ComputeCancelled, computeMap } from "../src/compute";
import { DEFAULT_MAP_GEO_LOCATION, type GeoEnvSnapshot } from "../src/env";
import { holedMask } from "../src/geo-utils";
import { applyQuestionsToMapGeoData } from "../src/index";
import { questionsSchema } from "../src/schema";

// A 2°×2° box over the Netherlands as the playable area (no network needed).
const AREA = turf.featureCollection([
    turf.bboxPolygon([4, 51, 6, 53]),
]) as FeatureCollection<Polygon | MultiPolygon>;

const env = (overrides: Partial<GeoEnvSnapshot> = {}): GeoEnvSnapshot => ({
    defaultUnit: "kilometers",
    hiderMode: false,
    mapGeoLocation: DEFAULT_MAP_GEO_LOCATION,
    additionalMapGeoLocations: [],
    polyGeoJSON: structuredClone(AREA),
    mapGeoJSON: null,
    trainStations: [],
    ...overrides,
});

const thermometer = (
    key: number,
    a: [number, number],
    b: [number, number],
    warmer: boolean,
) => ({
    id: "thermometer",
    key,
    data: {
        latA: a[1],
        lngA: a[0],
        latB: b[1],
        lngB: b[0],
        warmer,
        drag: false,
        collapsed: true,
    },
});

const QUESTIONS = () =>
    questionsSchema.parse([
        // Seekers moved east and got warmer → hider is in the eastern half.
        thermometer(1, [4.5, 52], [5.5, 52], true),
        // Moved north and got colder → hider is in the southern half.
        thermometer(2, [5, 51.5], [5, 52.5], false),
    ]);

const area = (fc: any) => turf.area(fc);

describe("computeMap (worker pipeline)", () => {
    beforeEach(() => clearComputeMemo());

    it("matches the original main-thread pipeline exactly", async () => {
        const questions = QUESTIONS();
        const result = await computeMap({
            questions,
            env: env(),
            planningModeEnabled: false,
        });

        // The pre-rewrite path from Map.tsx: apply → holed mask → simplify.
        const legacy = await applyQuestionsToMapGeoData(
            QUESTIONS(),
            structuredClone(AREA),
            false,
        );
        const legacyMask = turf.simplify(
            {
                type: "FeatureCollection",
                features: [holedMask(legacy)!],
            } as any,
            { tolerance: 0.001, highQuality: false },
        );

        expect(result.eliminationMask).toEqual(legacyMask);
        expect(result.baseMapGeoJSON).toEqual(AREA);
    });

    it("eliminates the expected quadrant", async () => {
        const result = await computeMap({
            questions: QUESTIONS(),
            env: env(),
            planningModeEnabled: false,
        });
        const remaining = holedMask(result.eliminationMask as any)!;
        // South-east quadrant of the box remains (≈ 1/4 of the area, ±2%).
        expect(area(remaining) / area(AREA)).toBeGreaterThan(0.23);
        expect(area(remaining) / area(AREA)).toBeLessThan(0.27);
        expect(turf.booleanPointInPolygon([5.5, 51.5], remaining as any)).toBe(
            true,
        );
        expect(turf.booleanPointInPolygon([4.5, 52.5], remaining as any)).toBe(
            false,
        );

        const [minLng, minLat, maxLng, maxLat] = result.bbox!;
        expect(minLng).toBeCloseTo(5, 1);
        expect(maxLng).toBeCloseTo(6, 1);
        expect(minLat).toBeCloseTo(51, 1);
        expect(maxLat).toBeCloseTo(52, 1);
    });

    it("returns identical results from the memo cache", async () => {
        const first = await computeMap({
            questions: QUESTIONS(),
            env: env(),
            planningModeEnabled: false,
        });
        const again = await computeMap({
            questions: QUESTIONS(),
            env: env(),
            planningModeEnabled: false,
        });
        expect(again.eliminationMask).toEqual(first.eliminationMask);

        // Changing the last question must not reuse its cached step.
        const changed = QUESTIONS();
        (changed[1].data as any).warmer = true;
        const third = await computeMap({
            questions: changed,
            env: env(),
            planningModeEnabled: false,
        });
        expect(third.eliminationMask).not.toEqual(first.eliminationMask);
        expect(
            turf.booleanPointInPolygon(
                [5.5, 52.5],
                holedMask(third.eliminationMask as any) as any,
            ),
        ).toBe(true);
    });

    it("ignores UI-only state (collapsed) for caching", async () => {
        const a = await computeMap({
            questions: QUESTIONS(),
            env: env(),
            planningModeEnabled: false,
        });
        const collapsed = QUESTIONS();
        (collapsed[0].data as any).collapsed = false;
        const b = await computeMap({
            questions: collapsed,
            env: env(),
            planningModeEnabled: false,
        });
        expect(b.eliminationMask).toEqual(a.eliminationMask);
    });

    it("can be cancelled between steps", async () => {
        let calls = 0;
        await expect(
            computeMap(
                {
                    questions: QUESTIONS(),
                    env: env(),
                    planningModeEnabled: false,
                },
                () => ++calls > 1,
            ),
        ).rejects.toBeInstanceOf(ComputeCancelled);
    });

    it("hiderifies answers from the hider position", async () => {
        const questions = questionsSchema.parse([
            {
                ...thermometer(1, [4.5, 52], [5.5, 52], true),
                data: {
                    ...thermometer(1, [4.5, 52], [5.5, 52], true).data,
                    drag: true,
                },
            },
        ]);
        // Hider in the west: moving east makes the seekers colder.
        const result = await computeMap({
            questions,
            env: env({ hiderMode: { latitude: 52, longitude: 4.2 } }),
            planningModeEnabled: false,
        });
        expect(result.hiderifiedQuestions).toHaveLength(1);
        expect((result.hiderifiedQuestions![0].data as any).warmer).toBe(false);
    });

    it("skips unlocked questions and returns planning polygons in planning mode", async () => {
        const questions = questionsSchema.parse([
            {
                ...thermometer(7, [4.5, 52], [5.5, 52], true),
                data: {
                    ...thermometer(7, [4.5, 52], [5.5, 52], true).data,
                    drag: true,
                },
            },
        ]);
        const result = await computeMap({
            questions,
            env: env(),
            planningModeEnabled: true,
        });
        expect(result.planningPolygons.map((p) => p.key)).toEqual([7]);
        // Nothing eliminated: the whole box remains.
        const remaining = holedMask(result.eliminationMask as any)!;
        expect(area(remaining) / area(AREA)).toBeGreaterThan(0.98);
    });

    it("produces structured-cloneable output (worker transfer)", async () => {
        const result = await computeMap({
            questions: QUESTIONS(),
            env: env(),
            planningModeEnabled: false,
        });
        expect(() => structuredClone(result)).not.toThrow();
    });
});
