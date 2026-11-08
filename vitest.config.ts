import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            "packages/shared",
            "packages/geo",
            "apps/server",
            "apps/web",
        ],
    },
});
