// A tiny stand-in for the Overpass API so e2e tests are hermetic and fast.
// It understands the handful of query shapes the geo engine sends and returns
// plausible OSM JSON: a square boundary for any relation, a box around a point
// for admin-area lookups, and a few named places for POI searches.
import http from "node:http";

/** The test play area (matches e2e/fixtures.ts AREA). */
export const AREA_BBOX = {
    minLat: 52.0,
    minLon: 4.9,
    maxLat: 52.2,
    maxLon: 5.3,
};

const ring = ({ minLat, minLon, maxLat, maxLon }) => [
    { lat: minLat, lon: minLon },
    { lat: minLat, lon: maxLon },
    { lat: maxLat, lon: maxLon },
    { lat: maxLat, lon: minLon },
    { lat: minLat, lon: minLon },
];

function boundary(id, box, name) {
    return {
        type: "relation",
        id,
        bounds: box,
        tags: {
            type: "boundary",
            boundary: "administrative",
            admin_level: "8",
            name,
        },
        members: [
            {
                type: "way",
                ref: id * 10 + 1,
                role: "outer",
                geometry: ring(box),
            },
        ],
    };
}

const title = (value) =>
    String(value)
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

let nextId = 1000;
function place(lat, lon, name, extra = {}) {
    return {
        type: "node",
        id: nextId++,
        lat,
        lon,
        tags: { name, "name:en": name, iata: "AAA", ...extra },
    };
}

/** Value of the first `["key"="value"]` filter in a query fragment. */
const filterValue = (fragment) =>
    fragment.match(/\["?[^"\]=]+"?="?([^"\]]+)"?\]/)?.[1] ?? "place";

export function respond(query) {
    // relation(123);out geom;  → the play-area boundary
    let m = query.match(/\b(relation|way)\((\d+)\);\s*out geom/);
    if (m) return { elements: [boundary(Number(m[2]), AREA_BBOX, "Utrecht")] };

    // is_in(lat, lng) → admin_level boundary: a box around the point
    m = query.match(/is_in\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
    if (m) {
        const lat = Number(m[1]);
        const lon = Number(m[2]);
        const box = {
            minLat: lat - 0.03,
            minLon: lon - 0.05,
            maxLat: lat + 0.03,
            maxLon: lon + 0.05,
        };
        return { elements: [boundary(900001, box, "District")] };
    }

    // ...(around:METERS, lat, lng) → three places inside the radius
    m = query.match(
        /(\[[^(]*)\(around:\s*([\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/,
    );
    if (m) {
        const kind = title(filterValue(m[1]));
        const meters = Number(m[2]);
        const lat = Number(m[3]);
        const lon = Number(m[4]);
        const deg = (f) => (meters * f) / 111_320;
        return {
            elements: [
                place(lat + deg(0.2), lon, `${kind} North`),
                place(
                    lat,
                    lon + deg(0.4) / Math.cos((lat * Math.PI) / 180),
                    `${kind} East`,
                ),
                place(lat - deg(0.6), lon, `${kind} South`),
            ],
        };
    }

    // out tags (train line lookups) → nothing
    if (/out tags/.test(query)) return { elements: [] };

    // Searches inside the play area: (poly:"lat lon …") or map_to_area.
    const box = (() => {
        const poly = query.match(/\(poly:"([^"]+)"\)/);
        if (!poly) return AREA_BBOX;
        const nums = poly[1].trim().split(/\s+/).map(Number);
        const lats = nums.filter((_, i) => i % 2 === 0);
        const lons = nums.filter((_, i) => i % 2 === 1);
        return {
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats),
            minLon: Math.min(...lons),
            maxLon: Math.max(...lons),
        };
    })();
    const filters = [
        ...query.matchAll(
            /\b(?:node|way|relation|nwr|nw|wr|nr)(\[[^;]*?)\((?:poly|area)/g,
        ),
    ];
    if (filters.length) {
        const elements = [];
        filters.forEach((f, i) => {
            const kind = title(filterValue(f[1]));
            const at = (fx, fy) => [
                box.minLat + (box.maxLat - box.minLat) * fy,
                box.minLon + (box.maxLon - box.minLon) * fx,
            ];
            const shift = i * 0.03;
            for (const [fx, fy, label] of [
                [0.25 + shift, 0.3, "West"],
                [0.75 - shift, 0.3, "East"],
                [0.5, 0.75 - shift, "North"],
            ]) {
                const [lat, lon] = at(fx, fy);
                elements.push(place(lat, lon, `${kind} ${label}`));
            }
        });
        return { elements };
    }

    return { elements: [] };
}

/** Starts the fake on a random local port. */
export function startFakeOverpass() {
    const queries = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            const url = new URL(req.url ?? "/", "http://x");
            const raw =
                req.method === "POST"
                    ? new URLSearchParams(body).get("data")
                    : url.searchParams.get("data");
            const query = raw ?? "";
            queries.push(query);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
                JSON.stringify({
                    version: 0.6,
                    generator: "fake-overpass",
                    ...respond(query),
                }),
            );
        });
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/api/interpreter`,
                queries,
                close: () => server.close(),
            });
        });
    });
}
