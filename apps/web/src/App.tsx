import { useStore } from "@nanostores/react";
import { lazy, Suspense, useEffect, useState } from "react";

import { MultiplayerOverlay } from "@/components/MultiplayerOverlay";
import { appView } from "@/lib/game-store";

const loadGameUI = () => import("@/components/game/GameShell");
const GameUI = lazy(loadGameUI);
const Toasts = lazy(() => import("@/components/Toasts"));

/** `?s=`, `?hz=`, `?hzc=` or `?pb=`: someone shared a map setup. */
const hasSharedSetup = () =>
    typeof window !== "undefined" &&
    /[?&](s|hz|hzc|pb)=/.test(window.location.search);

/**
 * The landing page renders from the small initial bundle (and is prerendered
 * into index.html at build time). The map UI (Leaflet, Turf, sidebars…) is
 * fetched once the user starts interacting and mounted when they enter a
 * game. It stays mounted afterwards.
 */
export function App() {
    const view = useStore(appView);
    const [showGame, setShowGame] = useState(false);
    const [sharedSetup, setSharedSetup] = useState(false);

    useEffect(() => {
        if (view === "game" || view === "ended") setShowGame(true);
    }, [view]);

    // A shared map link: load the setup into this device's map settings so it
    // is used for the next game this player creates.
    useEffect(() => {
        if (!hasSharedSetup()) return;
        setSharedSetup(true);
        void import("@/lib/share").then((m) => m.loadSharedSetupFromUrl());
    }, []);

    useEffect(() => {
        // Fetch the map chunk once the user starts interacting (typing a name,
        // choosing create/join) — or after a while — so it never competes with
        // the landing page for bandwidth on slow mobile connections.
        let done = false;
        const preload = () => {
            if (done) return;
            done = true;
            void loadGameUI();
            cleanup();
        };
        const events = ["pointerdown", "keydown", "focusin"] as const;
        events.forEach((e) =>
            window.addEventListener(e, preload, { once: true, passive: true }),
        );
        const timer = setTimeout(preload, 8000);
        const cleanup = () => {
            clearTimeout(timer);
            events.forEach((e) => window.removeEventListener(e, preload));
        };
        return cleanup;
    }, []);

    return (
        <>
            <div id="app-root-container">
                <MultiplayerOverlay />
            </div>
            {showGame && (
                <Suspense
                    fallback={<div className="fixed inset-0 bg-jetlag" />}
                >
                    <GameUI />
                </Suspense>
            )}
            {(view !== "landing" || sharedSetup) && (
                <Suspense fallback={null}>
                    <Toasts />
                </Suspense>
            )}
        </>
    );
}
