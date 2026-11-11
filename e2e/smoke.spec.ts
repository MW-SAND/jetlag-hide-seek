import { expect, test } from "@playwright/test";

import { mockExternalServices, seedLocalState } from "./fixtures";

test.describe("smoke", () => {
    test("landing page renders quickly with a small initial bundle", async ({
        page,
        context,
    }) => {
        await mockExternalServices(context);
        await seedLocalState(context);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text());
        });

        const scripts: { url: string; bytes: number }[] = [];
        page.on("response", async (res) => {
            if (res.request().resourceType() !== "script") return;
            const length = Number(res.headers()["content-length"] ?? 0);
            scripts.push({ url: res.url(), bytes: length });
        });

        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("landing-submit")).toBeVisible();

        // Budget for JS needed to show the landing page (compressed). The map
        // chunk is only fetched once the user interacts.
        const initialBytes = scripts.reduce((sum, s) => sum + s.bytes, 0);
        expect(initialBytes).toBeGreaterThan(0);
        expect(initialBytes).toBeLessThan(100 * 1024);
        expect(scripts.some((s) => /GameShell-/.test(s.url))).toBe(false);

        // The landing page is prerendered: it's in the HTML before any JS runs.
        const html = await (await page.request.get("/")).text();
        expect(html).toContain("Hide &amp; Seek");
        expect(html).toContain('data-testid="landing-submit"');

        expect(errors).toEqual([]);
    });

    test("serves precompressed, cacheable assets and a strict CSP", async ({
        request,
    }) => {
        const html = await request.get("/", {
            headers: { "accept-encoding": "br" },
        });
        expect(html.headers()["cache-control"]).toBe("no-cache");
        expect(html.headers()["content-security-policy"]).toContain(
            "default-src 'self'",
        );
        const asset = (await html.text()).match(
            /\/assets\/index-[^"]+\.js/,
        )![0];
        const js = await request.get(asset, {
            headers: { "accept-encoding": "br, gzip" },
        });
        expect(js.headers()["content-encoding"]).toBe("br");
        expect(js.headers()["cache-control"]).toContain("immutable");
    });

    test("healthz", async ({ request }) => {
        const res = await request.get("/healthz");
        expect(res.ok()).toBe(true);
        expect((await res.json()).ok).toBe(true);
    });
});
