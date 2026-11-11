import { expect, test } from "@playwright/test";

import {
    askQuestion,
    cardByOrder,
    createGame,
    expectClean,
    joinViaInvite,
    newPlayer,
    startGame,
} from "./fixtures";

test.describe("lobby and multiplayer edge cases", () => {
    test.setTimeout(120_000);

    test("leaving the lobby and joining again with the code", async ({
        browser,
    }) => {
        const host = await newPlayer(browser, "Hal", "desktop");
        const guest = await newPlayer(browser, "Gus", "mobile");
        const code = await createGame(host, "hider");
        await joinViaInvite(guest, code, "seeker");
        await expect(host.page.getByTestId("lobby-player")).toHaveCount(2);
        await expect(host.page.getByTestId("start-game")).toBeEnabled();

        await guest.page.getByRole("button", { name: "Leave game" }).click();
        await expect(guest.page.getByTestId("landing-submit")).toBeVisible();
        await expect(host.page.getByTestId("lobby-player")).toHaveCount(1);
        await expect(host.page.getByTestId("start-game")).toBeDisabled();

        // Typing the code by hand works too (name is remembered).
        await guest.page.getByTestId("tab-join").click();
        await guest.page.getByPlaceholder("ABC123").fill(code.toLowerCase());
        await expect(
            guest.page.getByPlaceholder("Enter your name"),
        ).toHaveValue("Gus");
        await guest.page.getByTestId("role-seeker").click();
        await guest.page.getByTestId("landing-submit").click();
        await expect(guest.page.getByTestId("lobby")).toBeVisible();
        await expect(host.page.getByTestId("lobby-player")).toHaveCount(2);

        expectClean(host);
        expectClean(guest);
        await host.context.close();
        await guest.context.close();
    });

    test("three players: seekers share questions, the hider can host", async ({
        browser,
    }) => {
        const hider = await newPlayer(browser, "Hilde", "desktop");
        const seekerA = await newPlayer(browser, "Ada", "mobile");
        const seekerB = await newPlayer(browser, "Bob", "desktop");
        const code = await createGame(hider, "hider");
        await joinViaInvite(seekerA, code, "seeker");
        await joinViaInvite(seekerB, code, "seeker");
        for (const p of [hider, seekerA, seekerB]) {
            await expect(p.page.getByTestId("lobby-player")).toHaveCount(3);
        }
        await startGame(hider, seekerA, seekerB);

        // The hiding host owns the area tools; seekers don't.
        await expect(hider.page.locator(".leaflet-draw")).toHaveCount(1);
        await expect(seekerA.page.locator(".leaflet-draw")).toHaveCount(0);
        await expect(seekerB.page.locator(".leaflet-draw")).toHaveCount(0);

        // A draft stays private until it's sent; then every seeker sees it.
        const draft = await askQuestion(seekerA, "radius");
        await expect(seekerB.page.getByTestId("question-card")).toHaveCount(0);
        await draft.getByTestId("send-question").click();
        await expect(cardByOrder(seekerB.page, 1)).toHaveAttribute(
            "data-status",
            "sent",
        );

        const answer = hider.page.locator(
            '[data-testid="answer-card"][data-question-order="1"]',
        );
        await expect(answer.getByTestId("send-answer")).toBeEnabled({
            timeout: 30_000,
        });
        await answer.getByTestId("send-answer").click();
        for (const p of [seekerA, seekerB]) {
            await expect(cardByOrder(p.page, 1)).toHaveAttribute(
                "data-status",
                "answered",
            );
        }

        // Players list shows everyone with roles.
        await seekerB.page.getByTestId("players-button").click();
        const list = seekerB.page.getByRole("dialog");
        for (const name of ["Hilde", "Ada", "Bob"])
            await expect(list.getByText(name)).toBeVisible();
        await seekerB.page.keyboard.press("Escape");

        // A seeker leaves mid-game; the others see it, and the game goes on.
        await seekerB.page.getByTestId("open-menu").click();
        await seekerB.page.getByTestId("leave-game").click();
        await expect(seekerB.page.getByRole("alertdialog")).toContainText(
            "can't be rejoined",
        );
        await seekerB.page.getByTestId("confirm-leave").click();
        await expect(seekerB.page.getByTestId("landing-submit")).toBeVisible();
        await expect(hider.page.getByTestId("players-button")).toContainText(
            "2",
        );

        // Late joiners are turned away with a clear message.
        await seekerB.page.getByTestId("tab-join").click();
        await seekerB.page.getByPlaceholder("ABC123").fill(code);
        await seekerB.page.getByTestId("landing-submit").click();
        await expect(seekerB.page.getByRole("alert")).toHaveText(
            "This game has already started.",
        );
        seekerB.problems.splice(
            0,
            seekerB.problems.length,
            ...seekerB.problems.filter(
                (m) => !/HTTP 409 POST \/api\/games\/join/.test(m),
            ),
        );

        // Only the host may end the game.
        await seekerA.page.getByTestId("open-menu").click();
        await expect(seekerA.page.getByTestId("end-game")).toHaveCount(0);
        await seekerA.page.keyboard.press("Escape");
        await hider.page.getByTestId("open-menu").click();
        await hider.page.getByTestId("end-game").click();
        await hider.page.getByTestId("confirm-end-game").click();
        for (const p of [hider, seekerA]) {
            await expect(p.page.getByTestId("game-ended")).toContainText(
                "1Asked",
            );
        }

        for (const p of [hider, seekerA, seekerB]) {
            expectClean(p);
            await p.context.close();
        }
    });
});
