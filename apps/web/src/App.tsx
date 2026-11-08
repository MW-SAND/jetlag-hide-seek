import { useStore } from "@nanostores/react";
import { lazy, Suspense, useEffect, useState } from "react";

import { MultiplayerOverlay } from "@/components/MultiplayerOverlay";
import { appView } from "@/lib/game-store";

const loadGameUI = () => import("@/components/GameUI");
const GameUI = lazy(loadGameUI);

/**
 * The landing page renders from the small initial bundle (and is prerendered
 * into index.html at build time). The map UI (Leaflet, Turf, sidebars…) is
 * fetched once the user starts interacting and mounted when they enter a
 * game. It stays mounted afterwards.
 */
export function App() {
    const view = useStore(appView);
    const [showGame, setShowGame] = useState(false);

    useEffect(() => {
        if (view !== "landing") setShowGame(true);
    }, [view]);

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
        </>
    );
}
