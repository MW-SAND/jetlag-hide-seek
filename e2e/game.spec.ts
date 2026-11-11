import { type Browser, expect, type Page, test } from "@playwright/test";

import {
    apiFromPage,
    AREA_BBOX,
    askQuestion,
    cardByOrder,
    createGame,
    type Device,
    expectClean,
    expectNoHorizontalOverflow,
    joinViaInvite,
    newPlayer,
    type Player,
    startGame,
} from "./fixtures";

/** What the hider reads, and what the seeker sees after the answer. */
const KINDS = [
    {
        kind: "radius",
        prompt: /^Are you within .+ of the seekers\?$/,
        chip: /^(Inside|Outside)$/,
    },
    {
        kind: "thermometer",
        prompt: /warmer or colder\?$/,
        chip: /^(Warmer|Colder)$/,
    },
    {
        kind: "matching",
        prompt: /^Is your nearest .+ the same as the seekers'\?$/,
        chip: /^(Same|Different)$/,
    },
    {
        kind: "measuring",
        prompt: /closer to or further from a .+\?$/,
        chip: /^(Closer|Further)$/,
    },
    { kind: "tentacles", prompt: /which is closest to you\?$/, chip: /\S/ },
] as const;

/** On phones the panel is a bottom sheet; make sure a tab's content is shown. */
async function openTab(page: Page, tab: "answer" | "questions" | "zones") {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByTestId("game-panel")).not.toHaveAttribute(
        "data-snap",
        "peek",
    );
}

const answerCard = (page: Page, order: number) =>
    page.locator(`[data-testid="answer-card"][data-question-order="${order}"]`);
const undoCard = (page: Page, order: number) =>
    page.locator(`[data-testid="undo-card"][data-question-order="${order}"]`);

async function hiderSpot(page: Page) {
    const text = await page.getByText(/drag the pin to move it/).innerText();
    const [lat, lng] = text.match(/-?\d+\.\d+/g)!.map(Number);
    return { lat, lng };
}

function defineGame(seekerDevice: Device, hiderDevice: Device) {
    test.describe(`game: seeker on ${seekerDevice}, hider on ${hiderDevice}`, () => {
        test.describe.configure({ mode: "serial" });
        test.setTimeout(120_000);

        let browser: Browser;
        let seeker: Player; // host
        let hider: Player;
        let code = "";
        let gameId = "";
        let order = 0; // server order of the last sent question

        test.beforeAll(async ({ browser: b }) => {
            browser = b;
            seeker = await newPlayer(browser, "Sam", seekerDevice);
            hider = await newPlayer(browser, "Hana", hiderDevice);
        });

        test.afterAll(async () => {
            await seeker?.context.close();
            await hider?.context.close();
        });

        test("lobby: invite, pick the area, start", async () => {
            code = await createGame(seeker, "seeker");
            await expect(seeker.page.getByTestId("lobby-player")).toHaveCount(
                1,
            );
            await expect(seeker.page.getByTestId("start-game")).toBeDisabled();

            await joinViaInvite(hider, code, "hider");
            for (const p of [seeker, hider]) {
                const players = p.page.getByTestId("lobby-player");
                await expect(players).toHaveCount(2);
                await expect(players.filter({ hasText: "Sam" })).toHaveCount(1);
                await expect(players.filter({ hasText: "Hana" })).toHaveCount(
                    1,
                );
            }
            // Only the host can start or change the area.
            await expect(hider.page.getByTestId("start-game")).toHaveCount(0);
            await expect(hider.page.getByTestId("place-picker")).toHaveCount(0);
            await expect(
                hider.page.getByText("Waiting for the host to start…"),
            ).toBeVisible();

            // Host picks the area with a search (one tap on the result).
            await seeker.page.getByTestId("place-picker").click();
            await seeker.page
                .getByPlaceholder("Search place...")
                .fill("Utrecht");
            const result = seeker.page.getByTestId("place-result").first();
            await expect(result).toContainText("Utrecht");
            await expect(result).toContainText(/city · Netherlands/i);
            await result.click();
            await expect(seeker.page.getByTestId("place-picker")).toContainText(
                "Utrecht",
            );
            await expect(seeker.page.getByText("Play area:")).toContainText(
                "Utrecht",
            );

            gameId = (
                await apiFromPage(
                    seeker.page,
                    "GET",
                    `/api/games/by-code/${code}`,
                )
            ).json.gameId;
            await startGame(seeker, hider);
            for (const p of [seeker, hider]) {
                await expect(p.page.getByTestId("area-name")).toHaveText(
                    "Utrecht",
                );
                await expectNoHorizontalOverflow(p.page);
            }
        });

        test("the hider starts inside the play area, and it stays secret", async () => {
            await openTab(hider.page, "answer");
            await expect
                .poll(async () => (await hiderSpot(hider.page)).lat)
                .toBeGreaterThan(AREA_BBOX.minLat);
            const spot = await hiderSpot(hider.page);
            expect(spot.lat).toBeLessThan(AREA_BBOX.maxLat);
            expect(spot.lng).toBeGreaterThan(AREA_BBOX.minLon);
            expect(spot.lng).toBeLessThan(AREA_BBOX.maxLon);

            await expect
                .poll(async () => {
                    const loc = (
                        await apiFromPage(
                            hider.page,
                            "GET",
                            `/api/games/${gameId}/state`,
                        )
                    ).json.hiderLocation;
                    return (
                        loc &&
                        Math.abs(loc.lat - spot.lat) < 1e-4 &&
                        Math.abs(loc.lng - spot.lng) < 1e-4
                    );
                })
                .toBe(true);
            const seekerState = await apiFromPage(
                seeker.page,
                "GET",
                `/api/games/${gameId}/state`,
            );
            expect(seekerState.json).not.toHaveProperty("hiderLocation");
            const forged = await apiFromPage(
                seeker.page,
                "PUT",
                `/api/games/${gameId}/hider-location`,
                {
                    lat: 1,
                    lng: 1,
                },
            );
            expect(forged.status).toBe(403);
            seeker.problems.splice(0); // the forged request above is expected to fail

            // Only the host gets the area drawing tools.
            await expect(seeker.page.locator(".leaflet-draw")).toHaveCount(1);
            await expect(hider.page.locator(".leaflet-draw")).toHaveCount(0);

            // "Map centre" moves the hiding spot in one tap.
            await hider.page.getByTestId("hider-map-centre").click();
            await expect(
                hider.page.getByText("Hiding spot moved to the map centre"),
            ).toBeVisible();
        });

        for (const { kind, prompt, chip } of KINDS) {
            test(`ask and answer: ${kind}`, async () => {
                const card = await askQuestion(seeker, kind);
                await expect(card).toHaveAttribute("data-status", "editing");
                await card.getByTestId("send-question").click();
                order += 1;
                const sent = cardByOrder(seeker.page, order);
                await expect(sent).toHaveAttribute("data-status", "sent");
                await expect(sent).toContainText("Waiting");

                // The hider is taken straight to the question and reads it in plain words.
                const answer = answerCard(hider.page, order);
                await expect(answer).toBeVisible({ timeout: 15_000 });
                await expect(
                    hider.page.getByTestId("game-panel"),
                ).not.toHaveAttribute("data-snap", "peek");
                await expect(answer.getByTestId("answer-prompt")).toHaveText(
                    prompt,
                );
                await expect(hider.page.getByTestId("answer-badge")).toHaveText(
                    "1",
                );

                if (kind === "tentacles") {
                    const trigger = answer
                        .getByTestId("tentacle-select")
                        .getByRole("combobox");
                    await expect(trigger).toBeEnabled({ timeout: 30_000 });
                    await trigger.click();
                    await hider.page
                        .getByRole("option", { name: /North$/ })
                        .click();
                } else {
                    // The answer is pre-selected from the hider's spot.
                    await expect(
                        answer.getByRole("radio", { checked: true }),
                    ).toHaveCount(1, { timeout: 30_000 });
                }
                await expect(answer.getByTestId("send-answer")).toBeEnabled({
                    timeout: 30_000,
                });
                await answer.getByTestId("send-answer").click();

                const undo = undoCard(hider.page, order);
                await expect(undo).toBeVisible();
                const given =
                    (await undo.innerText())
                        .match(/You answered:\s*(.+)/)?.[1]
                        ?.trim() ?? "";

                await expect(sent).toHaveAttribute("data-status", "answered", {
                    timeout: 15_000,
                });
                const chipText = (
                    await sent.getByTestId("answer-chip").innerText()
                ).trim();
                expect(chipText).toMatch(chip);
                // Both sides agree on what was answered.
                expect(given.toLowerCase()).toContain(chipText.toLowerCase());
                if (kind === "tentacles") expect(chipText).toMatch(/North$/);
            });
        }

        test("answered questions are drawn on both maps without errors", async () => {
            for (const p of [seeker, hider]) {
                await expect
                    .poll(() =>
                        p.page
                            .locator(
                                ".leaflet-overlay-pane canvas, .leaflet-overlay-pane path",
                            )
                            .count(),
                    )
                    .toBeGreaterThan(0);
                await expect(p.page.getByTestId("map-updating")).toBeHidden({
                    timeout: 30_000,
                });
                await expect(
                    p.page.getByText(/Couldn't update the map/),
                ).toHaveCount(0);
            }
        });

        test("the hider can undo an answer", async () => {
            const card = await askQuestion(seeker, "radius");
            await card.getByTestId("send-question").click();
            order += 1;
            const sent = cardByOrder(seeker.page, order);
            await expect(sent).toHaveAttribute("data-status", "sent");

            const answer = answerCard(hider.page, order);
            await expect(answer.getByTestId("send-answer")).toBeEnabled({
                timeout: 30_000,
            });
            await answer.getByTestId("send-answer").click();
            await expect(sent).toHaveAttribute("data-status", "answered");

            await undoCard(hider.page, order)
                .getByTestId("undo-answer")
                .click();
            await expect(answer).toBeVisible();
            await expect(sent).toHaveAttribute("data-status", "sent");

            // Pick the other option this time.
            await expect(
                answer.getByRole("radio", { checked: true }),
            ).toHaveCount(1, { timeout: 30_000 });
            const unchecked = answer.getByRole("radio", { checked: false });
            const label = (await unchecked.innerText()).split("\n")[0].trim();
            await unchecked.click();
            await answer.getByTestId("send-answer").click();
            await expect(sent).toHaveAttribute("data-status", "answered");
            await expect(sent.getByTestId("answer-chip")).toHaveText(
                label
                    .replace(/^(Yes|No), /, "")
                    .replace(/^\w/, (c) => c.toUpperCase()),
            );
        });

        test("the hider can veto with a reason", async () => {
            const card = await askQuestion(seeker, "matching");
            await card.getByTestId("send-question").click();
            order += 1;
            const sent = cardByOrder(seeker.page, order);

            const answer = answerCard(hider.page, order);
            await expect(answer).toBeVisible({ timeout: 15_000 });
            // Veto is available immediately, even while the suggestion is computed.
            await answer.getByTestId("veto-question").click();
            await answer.getByTestId("veto-reason").fill("Too far away");
            await answer.getByTestId("confirm-veto").click();
            await expect(answer).toHaveCount(0);

            await expect(sent).toHaveAttribute("data-status", "vetoed", {
                timeout: 15_000,
            });
            await sent.locator("button[aria-expanded]").click();
            await expect(sent).toContainText("Veto reason: Too far away");
        });

        test("seekers can lock, edit and delete drafts", async () => {
            const card = await askQuestion(seeker, "measuring");
            await expect(card).toHaveAttribute("data-status", "editing");
            await card.getByTestId("toggle-lock").click();
            await expect(card).toHaveAttribute("data-status", "locked");
            await card.getByTestId("toggle-lock").click();
            await expect(card).toHaveAttribute("data-status", "editing");
            // Hiders don't decide answers for unsent drafts: no "Result" toggle in a game.
            await expect(card.getByText("Result", { exact: true })).toHaveCount(
                0,
            );
            await card.getByTestId("delete-question").click();
            await seeker.page.getByTestId("confirm-delete").click();
            await expect(card).toHaveCount(0);
        });

        test("panel tabs, map style and players list", async () => {
            for (const p of [seeker, hider]) {
                const { page } = p;
                await openTab(page, "zones");
                const toggle = page.getByTestId("toggle-hiding-zones");
                const before = await toggle.getAttribute("aria-checked");
                await toggle.click();
                await expect(toggle).not.toHaveAttribute(
                    "aria-checked",
                    before!,
                );
                await toggle.click();
                await expect(toggle).toHaveAttribute("aria-checked", before!);
                await openTab(page, "questions");
                if (p.device === "mobile") {
                    const panel = page.getByTestId("game-panel");
                    while ((await panel.getAttribute("data-snap")) !== "peek")
                        await page.getByTestId("sheet-handle").click();
                }

                const tilesBefore = p.tiles.length;
                await page.getByTestId("map-style").click();
                await page.getByTestId("style-satellite").click();
                await expect
                    .poll(() =>
                        p.tiles
                            .slice(tilesBefore)
                            .some((u) => /World_Imagery/.test(u)),
                    )
                    .toBe(true);
                await page.getByTestId("style-streets").click();
                await page.keyboard.press("Escape");

                await page.getByTestId("players-button").click();
                await expect(
                    page.getByRole("dialog").getByText("Sam"),
                ).toBeVisible();
                await expect(
                    page.getByRole("dialog").getByText("Hana"),
                ).toBeVisible();
                await page.keyboard.press("Escape");
            }
        });

        test("phone bottom sheet: drag handle and map buttons", async () => {
            for (const p of [seeker, hider].filter(
                (x) => x.device === "mobile",
            )) {
                const { page } = p;
                const panel = page.getByTestId("game-panel");
                const handle = page.getByTestId("sheet-handle");
                while ((await panel.getAttribute("data-snap")) !== "peek")
                    await handle.click();
                const order: string[] = [];
                for (let i = 0; i < 3; i++) {
                    await handle.click();
                    order.push((await panel.getAttribute("data-snap"))!);
                }
                expect(order).toEqual(["half", "full", "peek"]);

                // The map buttons always sit just above the sheet.
                for (const snap of ["peek", "half"]) {
                    while ((await panel.getAttribute("data-snap")) !== snap)
                        await handle.click();
                    await page.waitForTimeout(400);
                    const button = await page
                        .getByTestId("map-style")
                        .boundingBox();
                    const sheet = await panel.boundingBox();
                    expect(button!.y + button!.height).toBeLessThanOrEqual(
                        sheet!.y,
                    );
                }
                while ((await panel.getAttribute("data-snap")) !== "peek")
                    await handle.click();
                await expectNoHorizontalOverflow(page);
            }
        });

        test("menu: invite players and share the map", async () => {
            const { page } = seeker;
            await page.getByTestId("open-menu").click();
            const invite = page.getByTestId("menu-invite");
            await expect(invite).toBeInViewport();
            await invite.click();
            await expect(page.getByText("Invite link copied")).toBeVisible();
            expect(
                await page.evaluate(() => navigator.clipboard.readText()),
            ).toMatch(new RegExp(`/#game/${code}$`));

            await page.getByTestId("share-map").click();
            await expect(page.getByText("Share link copied")).toBeVisible();
            const link = await page.evaluate(() =>
                navigator.clipboard.readText(),
            );
            expect(link).toMatch(/\?(hzc|s)=/);
            await page.keyboard.press("Escape");

            // Someone opening the link gets the map setup for their own game.
            const friend = await newPlayer(browser, "Fran", "mobile", {
                seed: false,
            });
            await friend.page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
            await expect(
                friend.page.getByText(
                    "Shared map loaded. Create a game to play on it.",
                ),
            ).toBeVisible();
            await createGame(friend, "seeker");
            await expect(friend.page.getByText("Play area:")).toContainText(
                "Utrecht",
            );
            expectClean(friend);
            await friend.context.close();
        });

        test("a refresh reconnects straight into the game", async () => {
            for (const p of [seeker, hider]) {
                await p.page.reload();
                await expect(p.page.getByTestId("game-shell")).toBeVisible();
                await expect(p.page.getByTestId("landing-submit")).toBeHidden();
                await expect(p.page.getByTestId("area-name")).toHaveText(
                    "Utrecht",
                );
            }
            await expect(cardByOrder(seeker.page, order)).toHaveAttribute(
                "data-status",
                "vetoed",
            );
        });

        test("the host ends the game for everyone", async () => {
            await seeker.page.getByTestId("open-menu").click();
            await seeker.page.getByTestId("end-game").click();
            await seeker.page.getByTestId("confirm-end-game").click();
            for (const p of [seeker, hider]) {
                const ended = p.page.getByTestId("game-ended");
                await expect(ended).toBeVisible();
                await expect(ended).toContainText(`${order}Asked`);
                await expect(ended).toContainText("1Vetoed");
            }
            await hider.page.getByTestId("ended-view-map").click();
            await expect(hider.page.getByTestId("game-shell")).toBeVisible();
            for (const p of [seeker, hider]) {
                await p.page.getByTestId("ended-home").click();
                await expect(
                    p.page.getByTestId("landing-submit"),
                ).toBeVisible();
            }
        });

        test("no errors and no unexpected third-party requests", () => {
            expectClean(seeker);
            expectClean(hider);
        });
    });
}

defineGame("mobile", "desktop");
defineGame("desktop", "mobile");
