import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "prompt",
            injectRegister: false,
            workbox: {
                // Precache the app shell; big data files are cached at runtime.
                maximumFileSizeToCacheInBytes: 2_500_000,
                globPatterns: [
                    "**/*.{js,css,html,woff2,png,ico,svg,webmanifest}",
                ],
                globIgnores: [
                    "**/*.geojson",
                    "**/og-image.png",
                    // Heavy, rarely-needed geometry chunks: cached on first use instead.
                    "**/assets/SpatialReference-*.js",
                    "**/assets/pe-wasm-*.js",
                    "**/assets/Operator*.js",
                    "**/assets/apiConverter-*.js",
                ],
                navigateFallback: "/index.html",
                navigateFallbackDenylist: [/^\/api\//, /^\/healthz/],
                runtimeCaching: [
                    {
                        urlPattern: ({ url, sameOrigin }) =>
                            sameOrigin && url.pathname.startsWith("/assets/"),
                        handler: "CacheFirst",
                        options: {
                            cacheName: "assets",
                            expiration: {
                                maxEntries: 60,
                                maxAgeSeconds: 60 * 24 * 60 * 60,
                            },
                        },
                    },
                    {
                        urlPattern: /\.geojson$/,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "geojson-cache",
                            expiration: {
                                maxEntries: 5,
                                maxAgeSeconds: 30 * 24 * 60 * 60,
                            },
                        },
                    },
                    {
                        urlPattern:
                            /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\//,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "tiles-carto",
                            expiration: {
                                maxEntries: 600,
                                maxAgeSeconds: 14 * 24 * 60 * 60,
                            },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                ],
            },
            manifest: {
                name: "Jet Lag Hide and Seek Map Generator",
                short_name: "Map Generator",
                description:
                    "Automatically generate maps for Jet Lag The Game: Hide and Seek with ease! Simply name the questions and watch the map eliminate hundreds of possibilities in seconds.",
                icons: [
                    {
                        src: "/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                theme_color: "#1F2F3F",
                background_color: "#1F2F3F",
                display: "standalone",
            },
        }),
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    worker: {
        format: "es",
    },
    ssr: {
        // The prerender bundle is self-contained (no node_modules lookups).
        noExternal: true,
    },
    build: {
        target: "es2022",
        sourcemap: false,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 1500,
    },
    server: {
        port: 5173,
        proxy: {
            "/api": { target: API_TARGET, changeOrigin: false },
            "/healthz": { target: API_TARGET },
        },
    },
    preview: {
        proxy: {
            "/api": { target: API_TARGET },
        },
    },
});
