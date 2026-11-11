import {
    type Browser,
    type BrowserContext,
    devices,
    expect,
    type Locator,
    type Page,
} from "@playwright/test";

/** 1×1 transparent PNG used for every map tile. */
const TILE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
);

/** The play area used by every test (same box as e2e/fake-overpass.mjs). */
export const AREA_BBOX = {
    minLat: 52.0,
    minLon: 4.9,
    maxLat: 52.2,
    maxLon: 5.3,
};

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

/** Photon search results (raw API format: [lng, lat], extent lng/lat). */
const PHOTON_PLACES = [
    {
        type: "Feature",
        geometry: { type: "Point", coordinates: [5.12, 52.09] },
        properties: {
            osm_type: "R",
            osm_id: 47667,
            extent: [4.9, 52.2, 5.3, 52.0],
            country: "Netherlands",
            state: "Utrecht",
            osm_key: "place",
            osm_value: "city",
            name: "Utrecht",
            type: "city",
        },
    },
    {
        type: "Feature",
        geometry: { type: "Point", coordinates: [5.2, 52.1] },
        properties: {
            osm_type: "R",
            osm_id: 47670,
            extent: [4.8, 52.3, 5.6, 51.9],
            country: "Netherlands",
            osm_key: "boundary",
            osm_value: "administrative",
            name: "Utrecht",
            type: "state",
        },
    },
];

export type Device = "desktop" | "mobile";

const DEVICES: Record<Device, Parameters<Browser["newContext"]>[0]> = {
    desktop: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 860 },
    },
    mobile: devices["Pixel 7"],
};

export interface Player {
    name: string;
    device: Device;
    context: BrowserContext;
    page: Page;
    /** Console errors, page errors and failed same-origin requests. */
    problems: string[];
    /** Every third-party URL requested. */
    external: string[];
    /** Map tile URLs requested. */
    tiles: string[];
}

/** Keep tests hermetic: fake tiles and geocoder; no other third parties. */
export async function mockExternalServices(
    context: BrowserContext,
    external: string[] = [],
    tiles: string[] = [],
) {
    await context.route(
        /^https?:\/\/(?!127\.0\.0\.1|localhost)/,
        async (route) => {
            const url = route.request().url();
            external.push(url);
            if (/arcgisonline|thunderforest|tile\.openstreetmap/.test(url)) {
                tiles.push(url);
                return route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: TILE,
                });
            }
            if (/photon\.komoot\.io/.test(url)) {
                const q =
                    new URL(url).searchParams.get("q")?.toLowerCase() ?? "";
                const features = PHOTON_PLACES.filter((f) =>
                    f.properties.name.toLowerCase().startsWith(q.slice(0, 3)),
                );
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        type: "FeatureCollection",
                        features,
                    }),
                });
            }
            // Direct Overpass is only a fallback when /api/overpass is down.
            if (/overpass/.test(url)) {
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: '{"elements":[]}',
                });
            }
            return route.abort();
        },
    );
}

/** Start with a known local state: no tutorial and the Utrecht test area. */
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

export async function newPlayer(
    browser: Browser,
    name: string,
    device: Device,
    options: { seed?: boolean; allow?: RegExp } = {},
): Promise<Player> {
    const context = await browser.newContext({
        ...DEVICES[device],
        permissions: ["clipboard-read", "clipboard-write"],
    });
    // Deterministic sharing: use the clipboard path, not the OS share sheet.
    await context.addInitScript(() => {
        Object.defineProperty(navigator, "share", {
            value: undefined,
            configurable: true,
        });
    });
    const player: Player = {
        name,
        device,
        context,
        page: null as any,
        problems: [],
        external: [],
        tiles: [],
    };
    await mockExternalServices(context, player.external, player.tiles);
    if (options.seed !== false) await seedLocalState(context);
    const page = await context.newPage();
    player.page = page;
    const allow = options.allow;
    const record = (message: string) => {
        if (!allow || !allow.test(message)) player.problems.push(message);
    };
    page.on("pageerror", (error) => record(`pageerror: ${error.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
            record(`console: ${m.text()}`);
    });
    page.on("response", (res) => {
        const url = res.url();
        if (
            res.status() >= 400 &&
            /^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)
        ) {
            record(
                `HTTP ${res.status()} ${res.request().method()} ${new URL(url).pathname}`,
            );
        }
    });
    return player;
}

export async function createGame(p: Player, role: "seeker" | "hider") {
    const { page } = p;
    await page.goto("/");
    await page.getByTestId("tab-create").click();
    await page.getByPlaceholder("Enter your name").fill(p.name);
    await page.getByTestId(`role-${role}`).click();
    await page.getByTestId("landing-submit").click();
    await expect(page.getByTestId("lobby")).toBeVisible();
    const code = (await page.getByTestId("room-code").innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    return code;
}

/** Join through the invite link (the form is pre-filled with the code). */
export async function joinViaInvite(
    p: Player,
    code: string,
    role: "seeker" | "hider",
) {
    const { page } = p;
    await page.goto(`/#game/${code}`);
    await expect(page.getByTestId("tab-join")).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(page.getByPlaceholder("ABC123")).toHaveValue(code);
    await page.getByPlaceholder("Enter your name").fill(p.name);
    await page.getByTestId(`role-${role}`).click();
    await page.getByTestId("landing-submit").click();
    await expect(page.getByTestId("lobby")).toBeVisible();
}

export async function startGame(host: Player, ...others: Player[]) {
    await host.page.getByTestId("start-game").click();
    for (const p of [host, ...others]) {
        await expect(p.page.getByTestId("game-shell")).toBeVisible();
    }
}

export const cardByOrder = (page: Page, order: number): Locator =>
    page.locator(`[data-testid="question-card"][data-question-key="${order}"]`);

/** Ask a question through the UI; returns the new (draft) card. */
export async function askQuestion(p: Player, kind: string): Promise<Locator> {
    const { page } = p;
    const keys = () =>
        page
            .getByTestId("question-card")
            .evaluateAll((els) =>
                els.map((el) => el.getAttribute("data-question-key")),
            );
    const before = new Set(await keys());
    await page.getByTestId("ask-question").click();
    await expect(page.getByTestId("ask-sheet")).toBeVisible();
    await page.getByTestId(`ask-${kind}`).click();
    await expect(page.getByTestId("ask-sheet")).toBeHidden();
    let added: string | undefined;
    await expect
        .poll(async () => {
            added =
                (await keys()).find((k) => k !== null && !before.has(k)) ??
                undefined;
            return added;
        })
        .toBeTruthy();
    const card = page.locator(
        `[data-testid="question-card"][data-question-key="${added}"]`,
    );
    await expect(card).toHaveAttribute("data-question-type", kind);
    return card;
}

/** Third-party hosts the app may contact. */
export const ALLOWED_THIRD_PARTIES =
    /server\.arcgisonline\.com|services\.arcgisonline\.com|photon\.komoot\.io/;

/** Assert a player saw no errors and only talked to allowed third parties. */
export function expectClean(p: Player) {
    expect(p.problems, `${p.name}: console/page/HTTP problems`).toEqual([]);
    expect(
        p.external.filter((url) => !ALLOWED_THIRD_PARTIES.test(url)),
        `${p.name}: unexpected third-party requests`,
    ).toEqual([]);
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

/** No element is wider than the screen (no sideways scrolling on phones). */
export async function expectNoHorizontalOverflow(page: Page) {
    const { scroll, width } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(width);
}

/** Interactive element is at least `min` CSS px in both directions. */
export async function expectTouchTarget(locator: Locator, min = 40) {
    const box = await locator.boundingBox();
    expect(box, "element should be visible").not.toBeNull();
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(min);
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(min);
}
