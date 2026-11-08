import type { BrowserContext, Page } from "@playwright/test";

/** 1×1 transparent PNG used for every map tile. */
const TILE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
);

/** A small square around Utrecht used as the playable area. */
export const AREA = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [4.9, 52.0],
                        [5.3, 52.0],
                        [5.3, 52.2],
                        [4.9, 52.2],
                        [4.9, 52.0],
                    ],
                ],
            },
        },
    ],
};

export const MAP_LOCATION = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [52.09, 5.12] },
    properties: {
        osm_type: "R",
        osm_id: 47667,
        extent: [52.2, 4.9, 52.0, 5.3],
        country: "Netherlands",
        osm_key: "place",
        countrycode: "NL",
        osm_value: "city",
        name: "Utrecht",
        type: "city",
    },
};

/** Every third-party URL requested by any page in this worker. */
export const externalRequests: string[] = [];

/**
 * Keep tests hermetic: no real tiles, Overpass, geocoder or ArcGIS CDN.
 */
export async function mockExternalServices(context: BrowserContext) {
    const requested = externalRequests;
    await context.route(
        /^https?:\/\/(?!127\.0\.0\.1|localhost)/,
        async (route) => {
            const url = route.request().url();
            requested.push(url);
            if (
                /basemaps\.cartocdn\.com|tile\.openstreetmap|arcgisonline|thunderforest/.test(
                    url,
                )
            ) {
                return route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: TILE,
                });
            }
            if (/overpass/.test(url)) {
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ elements: [] }),
                });
            }
            if (/photon\.komoot\.io/.test(url)) {
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        type: "FeatureCollection",
                        features: [],
                    }),
                });
            }
            return route.abort();
        },
    );
    return requested;
}

/** Start every page with a known local state (no tutorial, fixed area). */
export async function seedLocalState(context: BrowserContext) {
    await context.addInitScript(
        ({ area, location }) => {
            if (sessionStorage.getItem("__seeded")) return;
            sessionStorage.setItem("__seeded", "1");
            localStorage.setItem("showTutorials", "false");
            localStorage.setItem("polyGeoJSON", JSON.stringify(area));
            localStorage.setItem("mapGeoLocation", JSON.stringify(location));
        },
        { area: AREA, location: MAP_LOCATION },
    );
}

export async function newPlayer(context: BrowserContext): Promise<Page> {
    await mockExternalServices(context);
    await seedLocalState(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => {
        throw new Error(`Page error: ${error.message}`);
    });
    return page;
}

export async function createGame(
    page: Page,
    name: string,
    role: "Hider" | "Seeker",
) {
    await page.goto("/");
    await page.getByRole("button", { name: "Create Game" }).click();
    await page.getByPlaceholder("Enter your name").fill(name);
    await page.getByRole("button", { name: role, exact: true }).click();
    await page
        .locator('button:has-text("Create Game"):not([disabled])')
        .last()
        .click();
    await page.getByText("Room Code").waitFor();
    const code = page.url().match(/game\/([A-Z0-9]{6})/i)?.[1];
    if (!code) throw new Error("no room code in URL");
    return code;
}

export async function joinGame(
    page: Page,
    code: string,
    name: string,
    role: "Hider" | "Seeker",
) {
    await page.goto("/");
    await page.getByRole("button", { name: "Join Game" }).click();
    await page.getByPlaceholder("ABC123").fill(code);
    await page.getByPlaceholder("Enter your name").fill(name);
    await page.getByRole("button", { name: role, exact: true }).click();
    await page
        .locator('button:has-text("Join Game"):not([disabled])')
        .last()
        .click();
}

/** Calls the API from inside the page so the browser's cookie is used. */
export async function apiFromPage<T = any>(
    page: Page,
    method: string,
    url: string,
    body?: unknown,
): Promise<{ status: number; json: T }> {
    return page.evaluate(
        async ({ method, url, body }) => {
            const res = await fetch(url, {
                method,
                headers: {
                    "X-Requested-With": "jetlag",
                    ...(body !== undefined
                        ? { "Content-Type": "application/json" }
                        : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            const text = await res.text();
            return { status: res.status, json: text ? JSON.parse(text) : null };
        },
        { method, url, body },
    );
}
