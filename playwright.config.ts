import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 8090);
const external = process.env.E2E_BASE_URL;

export default defineConfig({
    testDir: "e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: external ?? `http://127.0.0.1:${PORT}`,
        trace: "retain-on-failure",
        ...devices["Desktop Chrome"],
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        {
            name: "mobile",
            use: { ...devices["Pixel 7"] },
            testMatch: /smoke\.spec\.ts/,
        },
    ],
    webServer: external
        ? undefined
        : {
              command: "node e2e/serve.mjs",
              url: `http://127.0.0.1:${PORT}/healthz`,
              reuseExistingServer: !process.env.CI,
              timeout: 30_000,
              env: { E2E_PORT: String(PORT) },
          },
});
