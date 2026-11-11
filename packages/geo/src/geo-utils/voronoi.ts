import * as turf from "@turf/turf";
import { geoMercator } from "d3-geo";
// @ts-expect-error No type declaration
import { geoProject, geoStitch } from "d3-geo-projection";
// @ts-expect-error No type declaration
import { geoVoronoi } from "d3-geo-voronoi";
import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

const scaleReference = turf.toMercator(turf.point([180, 90])); // I thought this would yield the same as turf.earthRadius * Math.pi, but it's slightly larger

// Voronoi construction (d3-geo-voronoi + projection) is the most expensive
// step in a tentacle question, and the same point set is fed to it multiple
// times per question (area adjustment, hider resolution, planning polygon).
// Memoize on a stable signature of the input points to compute it once.
const voronoiCache = new Map<
    string,
    FeatureCollection<Polygon | MultiPolygon>
>();
const VORONOI_CACHE_LIMIT = 32;

const pointsSignature = (points: FeatureCollection<Point>): string =>
    points.features
        .map(
            (f) =>
                `${f.properties?.name ?? ""}@${f.geometry.coordinates.join(",")}`,
        )
        .sort()
        .join("|");

export const geoSpatialVoronoi = (
    points: FeatureCollection<Point>,
): FeatureCollection<Polygon | MultiPolygon> => {
    const signature = pointsSignature(points);
    const cached = voronoiCache.get(signature);
    if (cached) return cached;

    const voronoi = geoVoronoi()(points).polygons();
    const projected = geoProject(
        geoStitch(voronoi),
        geoMercator().translate([0, 0]).precision(0.005),
    );

    const ratio = scaleReference.geometry.coordinates[0] / 480.5; // 961 is the default scale for some reason

    turf.coordEach(projected, (coord) => {
        coord[0] = coord[0] * ratio;
        coord[1] = coord[1] * -ratio; // y-coordinates are flipped
    });

    const result = turf.toWgs84(projected);

    if (voronoiCache.size >= VORONOI_CACHE_LIMIT) {
        const oldest = voronoiCache.keys().next().value;
        if (oldest !== undefined) voronoiCache.delete(oldest);
    }
    voronoiCache.set(signature, result);

    return result;
};
