import esriConfig from "@arcgis/core/config.js";
import * as units from "@arcgis/core/core/units.js";
import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator.js";
import * as geodeticDistanceOperator from "@arcgis/core/geometry/operators/geodeticDistanceOperator.js";
import Point from "@arcgis/core/geometry/Point.js";
import * as geometryJsonUtils from "@arcgis/core/geometry/support/jsonUtils.js";
import * as unionTypes from "@arcgis/core/unionTypes.js";
import { arcgisToGeoJSON, geojsonToArcGIS } from "@terraformer/arcgis";
import * as turf from "@turf/turf";
import type {
    Feature,
    FeatureCollection,
    MultiPolygon,
    Polygon,
} from "geojson";

import { BLANK_GEOJSON } from "../api";

export { geoSpatialVoronoi } from "./voronoi";

// Load the ArcGIS geometry WASM from our own origin (copied there at build
// time by apps/web/scripts/copy-arcgis-assets.mjs) instead of the ArcGIS CDN.
if (typeof self !== "undefined" && (self as any).location?.origin) {
    esriConfig.assetsPath = `${(self as any).location.origin}/arcgis`;
}

export const safeUnion = (input: FeatureCollection<Polygon | MultiPolygon>) => {
    if (input.features.length === 1) return input.features[0];
    const union = turf.union(input);
    if (union) return union;
    throw new Error("No features");
};

export const holedMask = (
    input:
        | Feature<Polygon | MultiPolygon>
        | FeatureCollection<Polygon | MultiPolygon>,
) => {
    return turf.difference(
        turf.featureCollection([
            BLANK_GEOJSON.features[0] as Feature<Polygon>,
            "features" in input ? safeUnion(input) : input,
        ]),
    );
};

export const modifyMapData = (
    mapData: FeatureCollection<Polygon | MultiPolygon>,
    modifications:
        | FeatureCollection<Polygon | MultiPolygon>
        | Feature<Polygon | MultiPolygon>,
    withinModifications: boolean,
) => {
    const safeModifications =
        "features" in modifications ? safeUnion(modifications) : modifications;

    if (withinModifications) {
        return turf.intersect(
            turf.featureCollection([safeUnion(mapData), safeModifications]),
        );
    }
    return turf.intersect(
        turf.featureCollection([
            safeUnion(mapData),
            holedMask(safeModifications)!,
        ]),
    );
};

const DEFAULT_BUFFER_UNIT = "miles";

export const arcBuffer = (
    geometry: FeatureCollection,
    distance: number,
    unit: units.LengthUnit & turf.Units = DEFAULT_BUFFER_UNIT,
) => {
    const arcgisGeometry = geometry.features.map((x) =>
        geometryJsonUtils.fromJSON(geojsonToArcGIS(x.geometry)),
    ) as unionTypes.GeometryUnion[];

    return innateArcBuffer(arcgisGeometry, distance, unit);
};

const innateArcBuffer = async (
    arcgisGeometry: unionTypes.GeometryUnion[],
    distance: number,
    unit: units.LengthUnit & turf.Units = DEFAULT_BUFFER_UNIT,
) => {
    await geodesicBufferOperator.load();

    const bufferedGeometry = geodesicBufferOperator.executeMany(
        arcgisGeometry,
        Array(arcgisGeometry.length).fill(distance),
        {
            union: true,
            unit: unit,
            maxDeviation: turf.convertLength(3, "feet", unit),
        },
    );

    return turf.combine(
        turf.featureCollection([
            turf.feature(arcgisToGeoJSON(bufferedGeometry[0] as any)),
        ]) as any,
    ).features[0] as Feature<MultiPolygon>;
};

export const arcBufferToPoint = async (
    geometry: FeatureCollection,
    lat: number,
    lng: number,
) => {
    const point = new Point({
        latitude: lat,
        longitude: lng,
    });

    const arcgisGeometry = geometry.features.map((x) =>
        geometryJsonUtils.fromJSON(geojsonToArcGIS(x.geometry)),
    ) as unionTypes.GeometryUnion[];

    await geodeticDistanceOperator.load();

    const distances = arcgisGeometry.map((x) =>
        geodeticDistanceOperator.execute(x, point, {
            unit: DEFAULT_BUFFER_UNIT,
        }),
    );

    return innateArcBuffer(arcgisGeometry, Math.min(...distances));
};

/**
 * Turf-only alternative to arcBufferToPoint. Uses geodesic distance and buffer
 * from Turf.js instead of ArcGIS WASM operators. Accurate to within ~0.05 km
 * at typical game distances (<200 mi). Significantly faster for complex geometries
 * like coastlines.
 */
export const turfBufferToPoint = (
    geometry: FeatureCollection,
    lat: number,
    lng: number,
): Feature<MultiPolygon> => {
    const point = turf.point([lng, lat]);

    const distances = geometry.features.map((feature) => {
        if (
            feature.geometry.type === "Polygon" ||
            feature.geometry.type === "MultiPolygon"
        ) {
            return turf.pointToPolygonDistance(point, feature as any, {
                units: DEFAULT_BUFFER_UNIT,
                method: "geodesic",
            });
        }
        return turf.distance(point, turf.centroid(feature), {
            units: DEFAULT_BUFFER_UNIT,
        });
    });

    const minDistance = Math.min(...distances);

    const buffered = turf.buffer(
        turf.featureCollection(geometry.features),
        minDistance,
        { units: DEFAULT_BUFFER_UNIT, steps: 48 },
    );

    return turf.combine(buffered!).features[0] as Feature<MultiPolygon>;
};
