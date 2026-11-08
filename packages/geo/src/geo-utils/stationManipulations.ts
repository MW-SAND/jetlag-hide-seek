import * as turf from "@turf/turf";

import type { StationPlace } from "../api";

/**
 * Function to merge duplicates stations into one station, by averaging their longitude and latitude
 * @param places    Array of all unmerged stations
 * @param radius    Radius of the hiding zone
 * @param units     turf.Units unit of the radius ("miles", "kilometers" etc.)
 * @returns         Array of all merged stations
 */
export function mergeDuplicateStation(
    places: StationPlace[],
    radius: number,
    units: turf.Units,
): StationPlace[] {
    // Step 3.1: O(n·g) algorithm — pre-group by name, then only check representative per zone-group
    const groupsByName = new Map<string, StationPlace[][]>();

    for (const place of places) {
        const name = place.properties.name ?? "";

        if (!groupsByName.has(name)) {
            groupsByName.set(name, [[place]]);
            continue;
        }

        const zoneGroups = groupsByName.get(name)!;
        let added = false;

        // Only check the representative (first station) of each zone-group
        for (const group of zoneGroups) {
            const representative = group[0];
            const station1: Location = {
                coordinates: place.geometry.coordinates,
            };
            const station2: Location = {
                coordinates: representative.geometry.coordinates,
            };

            if (checkIfStationsShareZones(station1, station2, radius, units)) {
                group.push(place);
                added = true;
                break;
            }
        }

        if (!added) {
            zoneGroups.push([place]);
        }
    }

    // Compute central point per group
    const merged: StationPlace[] = [];
    for (const zoneGroups of groupsByName.values()) {
        for (const group of zoneGroups) {
            const avgLng =
                group.reduce((sum, p) => sum + p.geometry.coordinates[0], 0) /
                group.length;
            const avgLat =
                group.reduce((sum, p) => sum + p.geometry.coordinates[1], 0) /
                group.length;

            merged.push({
                ...group[0],
                geometry: {
                    type: "Point",
                    coordinates: [avgLng, avgLat],
                },
            });
        }
    }
    return merged;
}

// Location object definition
export type Location = {
    name?: string;
    type?: string;
    coordinates: number[]; // [longitude, latitude]
};

/**
 * Check if two stations share a zone in a way that both centers are inside the others radius.
 * Both stations must lie within the given radius of each other.
 *
 * Matches:
 *      (...{Z1..Z2)...}
 * Does not match:
 *      (....Z1....) {....Z2....}
 * @param station1 First station location.
 * @param station2 Second station location.
 * @param radius   The zone radius around each station.
 * @param units    The unit for the radius ("miles","kilometers", "meters").
 * @returns        True if both stations share a zone, otherwise false.
 */
export function checkIfStationsShareZones(
    station1: Location,
    station2: Location,
    radius: number,
    units: turf.Units,
): boolean {
    // Convert to turf points
    const point1 = turf.point([
        station1.coordinates[0],
        station1.coordinates[1],
    ]);
    const point2 = turf.point([
        station2.coordinates[0],
        station2.coordinates[1],
    ]);

    // Distance of the 2 center points
    const d = turf.distance(point1, point2, { units });

    // If the distance of the 2 center points is smaller or equal of the radius, the 2 zones overlap.
    return d <= radius;
}
