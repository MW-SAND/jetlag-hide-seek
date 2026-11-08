import { type Browser, expect, type Page, test } from "@playwright/test";

import {
    apiFromPage,
    AREA,
    createGame,
    externalRequests,
    joinGame,
    newPlayer,
} from "./fixtures";

/**
 * Port of the old Supabase e2e test, now hermetic and with hard assertions:
 * create → join → lobby → start → ask → answer → undo window → secrecy →
 * refresh/rejoin → end.
 */
test.describe.configure({ mode: "serial" });

let browser: Browser;
let seeker: Page; // host
let hider: Page;
let code = "";
let gameId = "";
const consoleProblems: string[] = [];

test.beforeAll(async ({ browser: b }) => {
    browser = b;
    seeker = await newPlayer(await browser.newContext());
    hider = await newPlayer(await browser.newContext());
    for (const page of [seeker, hider]) {
        page.on("console", (m) => {
            if (m.type() === "error" || m.type() === "warning")
                consoleProblems.push(m.text());
        });
    }
});

test.afterAll(async () => {
    await seeker?.context().close();
    await hider?.context().close();
});

const openLeftSidebar = async (page: Page) => {
    const trigger = page
        .locator('[data-tutorial-id="left-sidebar-trigger"] button')
        .first();
    if (await trigger.isVisible()) await trigger.click();
};

test("host creates a game and a hider joins the lobby", async () => {
    code = await createGame(seeker, "Sam Seeker", "Seeker");
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    await joinGame(hider, code, "Hana Hider", "Hider");
    await hider.getByText("Room Code").waitFor();

    for (const page of [seeker, hider]) {
        await expect(page.getByText("2 joined")).toBeVisible();
        await expect(page.getByText("Sam Seeker")).toBeVisible();
        await expect(page.getByText("Hana Hider")).toBeVisible();
    }
    // Only the host may start.
    await expect(
        hider.locator('button:has-text("Start Game"):not([disabled])'),
    ).toHaveCount(0);

    const rejoin = await apiFromPage(
        seeker,
        "GET",
        `/api/games/by-code/${code}`,
    );
    gameId = rejoin.json.gameId;
});

test("starting moves both players to the map, synced live", async () => {
    await seeker
        .locator('button:has-text("Start Game"):not([disabled])')
        .click();
    for (const page of [seeker, hider]) {
        await expect(page.getByText("Start Game")).toBeHidden();
        await expect(page.locator(".leaflet-container")).toBeVisible();
    }

    // The host's playable area reached the server and the hider.
    await expect
        .poll(
            async () =>
                (
                    await apiFromPage(
                        hider,
                        "GET",
                        `/api/games/${gameId}/geo/polyGeoJSON`,
                    )
                ).json.value,
        )
        .toEqual(AREA);
});

test("the hider location never reaches seekers", async () => {
    await expect
        .poll(
            async () =>
                (await apiFromPage(hider, "GET", `/api/games/${gameId}/state`))
                    .json.hiderLocation,
        )
        .not.toBeNull();
    const seekerState = await apiFromPage(
        seeker,
        "GET",
        `/api/games/${gameId}/state`,
    );
    expect(seekerState.json).not.toHaveProperty("hiderLocation");
    const seekerHider = await apiFromPage(
        seeker,
        "PUT",
        `/api/games/${gameId}/hider-location`,
        { lat: 1, lng: 1 },
    );
    expect(seekerHider.status).toBe(403);
});

test("a question flows from seeker to hider and back", async () => {
    const asked = await apiFromPage(
        seeker,
        "POST",
        `/api/games/${gameId}/questions`,
        {
            type: "radius",
            data: {
                lat: 52.09,
                lng: 5.12,
                radius: 5,
                unit: "kilometers",
                within: true,
                color: "red",
                drag: false,
            },
        },
    );
    expect(asked.status).toBe(200);

    await openLeftSidebar(hider);
    await expect(hider.getByText("Awaiting Your Answer (1)")).toBeVisible();
    // The sidebar scrolls inside its own container; click via the DOM.
    await hider
        .getByRole("button", { name: /Send answer/ })
        .dispatchEvent("click");
    await expect(
        hider.getByText("Recently Answered (undo available)"),
    ).toBeAttached();

    await expect
        .poll(
            async () =>
                (await apiFromPage(seeker, "GET", `/api/games/${gameId}/state`))
                    .json.questions[0]?.answer,
        )
        .not.toBeNull();

    // The geo worker computed and drew the eliminated area on both maps
    // (Leaflet renders vector layers into a canvas because of preferCanvas).
    for (const page of [seeker, hider]) {
        await expect
            .poll(() =>
                page
                    .locator(
                        ".leaflet-overlay-pane canvas, .leaflet-overlay-pane path",
                    )
                    .count(),
            )
            .toBeGreaterThan(0);
    }
    expect(
        consoleProblems.filter((m) => /worker|No solutions found/i.test(m)),
    ).toEqual([]);
});

test("a refreshed player rejoins straight into the game", async () => {
    await seeker.reload();
    // The room code from the URL pre-opens the join form.
    await expect(seeker.getByPlaceholder("ABC123")).toHaveValue(code);
    await seeker.getByPlaceholder("Enter your name").fill("Sam Seeker");
    await seeker
        .locator('button:has-text("Join Game"):not([disabled])')
        .last()
        .click();
    await expect(seeker.locator(".leaflet-container")).toBeVisible();
    await expect(seeker.getByText("Room Code")).toBeHidden();
});

test("the host ends the game for everyone", async () => {
    const ended = await apiFromPage(seeker, "POST", `/api/games/${gameId}/end`);
    expect(ended.status).toBe(200);
    for (const page of [seeker, hider]) {
        await expect(
            page.getByText(/Game Over|Game Ended/i).first(),
        ).toBeVisible();
    }
});

test("no unexpected third-party requests were made", () => {
    const unexpected = externalRequests.filter(
        (url) =>
            !/basemaps\.cartocdn\.com|overpass|photon\.komoot\.io/.test(url),
    );
    expect(unexpected).toEqual([]);
});
