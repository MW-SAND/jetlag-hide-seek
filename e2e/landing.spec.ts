import { expect, test } from "@playwright/test";

import {
    createGame,
    expectClean,
    expectNoHorizontalOverflow,
    expectTouchTarget,
    newPlayer,
} from "./fixtures";

test.describe("start page", () => {
    test("guides the player through validation in as few taps as possible", async ({
        browser,
    }, info) => {
        const p = await newPlayer(
            browser,
            "Val",
            info.project.name === "mobile" ? "mobile" : "desktop",
        );
        const { page } = p;
        await page.goto("/");

        // "New game" is the default; submitting without a name explains why.
        await expect(page.getByTestId("tab-create")).toHaveAttribute(
            "aria-selected",
            "true",
        );
        await page.getByTestId("landing-submit").click();
        await expect(page.getByRole("alert")).toHaveText(
            "Enter your name first.",
        );
        await expect(page.getByPlaceholder("Enter your name")).toBeFocused();

        // Joining needs a 6-character code; the input normalises what's typed.
        await page.getByTestId("tab-join").click();
        await page.getByPlaceholder("Enter your name").fill("Val");
        await page.getByTestId("landing-submit").click();
        await expect(page.getByRole("alert")).toHaveText(
            "Enter the 6-character room code.",
        );
        await page.getByPlaceholder("ABC123").fill("ab-c1 23xyz");
        await expect(page.getByPlaceholder("ABC123")).toHaveValue("ABC123");
        await page
            .getByPlaceholder("ABC123")
            .fill("Join me: http://example.test/#game/XyZ789 !");
        await expect(page.getByPlaceholder("ABC123")).toHaveValue("XYZ789");

        // A code that doesn't exist gives a clear error and keeps the form.
        await page.getByTestId("landing-submit").click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.getByTestId("landing-submit")).toBeVisible();

        // Big, thumb-friendly controls and no sideways scrolling.
        for (const id of [
            "tab-create",
            "tab-join",
            "role-seeker",
            "role-hider",
            "landing-submit",
        ]) {
            await expectTouchTarget(page.getByTestId(id));
        }
        await expectNoHorizontalOverflow(page);

        p.problems.splice(
            0,
            p.problems.length,
            ...p.problems.filter(
                (m) => !/HTTP 4\d\d POST \/api\/games\/join/.test(m),
            ),
        );
        expectClean(p);
        await p.context.close();
    });

    test("remembers the player's name for next time", async ({
        browser,
    }, info) => {
        const p = await newPlayer(
            browser,
            "Remy",
            info.project.name === "mobile" ? "mobile" : "desktop",
        );
        await createGame(p, "seeker");
        await p.page.getByRole("button", { name: "Leave game" }).click();
        await expect(p.page.getByTestId("landing-submit")).toBeVisible();
        await expect(p.page.getByPlaceholder("Enter your name")).toHaveValue(
            "Remy",
        );
        expectClean(p);
        await p.context.close();
    });

    test("an invite link opens the join form with the code filled in", async ({
        browser,
    }, info) => {
        const device = info.project.name === "mobile" ? "mobile" : "desktop";
        const host = await newPlayer(browser, "Hosty", device);
        const code = await createGame(host, "seeker");

        const guest = await newPlayer(browser, "Guesty", device);
        await guest.page.goto(`/#game/${code}`);
        await expect(guest.page.getByTestId("tab-join")).toHaveAttribute(
            "aria-selected",
            "true",
        );
        await expect(guest.page.getByPlaceholder("ABC123")).toHaveValue(code);
        // The code is removed from the address bar (no accidental re-sharing).
        await expect
            .poll(() => guest.page.evaluate(() => location.hash))
            .toBe("");
        // A new invitee never probes the room before joining.
        expect(guest.problems).toEqual([]);

        await guest.page.getByPlaceholder("Enter your name").fill("Guesty");
        await guest.page.getByTestId("landing-submit").click();
        await expect(guest.page.getByTestId("lobby")).toBeVisible();
        await expect(host.page.getByTestId("lobby-player")).toHaveCount(2);

        expectClean(host);
        expectClean(guest);
        await host.context.close();
        await guest.context.close();
    });
});
