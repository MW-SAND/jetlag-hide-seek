import { afterEach, describe, expect, it, vi } from "vitest";

import { findTentacleLocations } from "../src/api";

const OVERPASS_PAYLOAD = {
    elements: [
        {
            type: "node",
            lat: 40.0,
            lon: -74.0,
            tags: { name: "Park A", tourism: "theme_park" },
        },
        {
            // Duplicate name — should be collapsed by the O(n) de-dupe.
            type: "node",
            lat: 40.1,
            lon: -74.1,
            tags: { name: "Park A", tourism: "theme_park" },
        },
        {
            type: "way",
            center: { lat: 40.2, lon: -74.2 },
            tags: { name: "Park B" },
        },
        {
            // No name — should be skipped.
            type: "node",
            lat: 40.3,
            lon: -74.3,
            tags: {},
        },
        {
            // name:en preferred over name.
            type: "node",
            lat: 40.4,
            lon: -74.4,
            tags: { "name:en": "Park C", name: "Parque C" },
        },
    ],
};

function mockFetch() {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(OVERPASS_PAYLOAD), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    return { calls, fn };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("findTentacleLocations", () => {
    it("de-duplicates by name, prefers name:en, and skips unnamed", async () => {
        mockFetch();

        const result = await findTentacleLocations({
            locationType: "theme_park",
            lat: 41.0,
            lng: -71.0,
            radius: 10,
            unit: "miles",
        } as any);

        const names = result.features.map((f: any) => f.properties.name).sort();
        expect(names).toEqual(["Park A", "Park B", "Park C"]);

        // First occurrence coordinates are kept for the duplicated name.
        const parkA = result.features.find(
            (f: any) => f.properties.name === "Park A",
        );
        expect(parkA?.geometry.coordinates).toEqual([-74.0, 40.0]);
    });

    it("searches a full circle around the point and never restricts to the narrowed zone", async () => {
        const { calls } = mockFetch();

        await findTentacleLocations({
            locationType: "theme_park",
            lat: 42.5,
            lng: -72.5,
            radius: 10,
            unit: "miles",
        } as any);

        expect(calls.length).toBeGreaterThan(0);
        const query = decodeURIComponent(calls[0]);
        // Must be an "around:" circle centered on the question point...
        expect(query).toContain("around:");
        expect(query).toContain("42.5");
        expect(query).toContain("-72.5");
        // ...and must NOT clip candidates to the narrowed play area.
        expect(query).not.toContain("poly:");
    });

    it("caches results so repeated lookups don't refetch", async () => {
        const { fn } = mockFetch();

        const question = {
            locationType: "theme_park",
            lat: 43.25,
            lng: -73.25,
            radius: 10,
            unit: "miles",
        } as any;

        await findTentacleLocations(question);
        await findTentacleLocations(question);

        expect(fn).toHaveBeenCalledTimes(1);
    });
});
