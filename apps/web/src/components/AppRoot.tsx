import { useStore } from "@nanostores/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { appView, gameSession, initFromHash } from "@/lib/multiplayer";

import { LandingPage } from "./LandingPage";

// Only the landing page is part of the initial bundle.
const GameLobby = lazy(() =>
    import("./GameLobby").then((m) => ({ default: m.GameLobby })),
);
const GameEndedOverlay = lazy(() =>
    import("./GameEndedOverlay").then((m) => ({ default: m.GameEndedOverlay })),
);
const loadSync = () => import("@/lib/multiplayer-sync");

/** Room code from a `#game/CODE` link, read once at startup. */
const readInitialRoomCode = () =>
    typeof window === "undefined" ? undefined : (initFromHash() ?? undefined);

/**
 * Top-level view router. Renders either:
 * - LandingPage (create/join)
 * - GameLobby (setup phase)
 * - GameEndedOverlay (ended)
 * - null (game phase — the map UI renders beneath)
 *
 * The first render is synchronous so it matches the prerendered landing page.
 */
export function AppRoot() {
    const view = useStore(appView);
    const session = useStore(gameSession);
    const [initialRoomCode] = useState(readInitialRoomCode);
    const syncStarted = useRef(false);

    useEffect(() => {
        // Opening the app always lands on the menu. A room code in the hash
        // pre-fills the Join form and is then removed from the URL.
        if (initialRoomCode) {
            window.history.replaceState(
                {},
                "",
                `${window.location.pathname}${window.location.search}`,
            );
        }
    }, [initialRoomCode]);

    // Start sync when entering game view
    useEffect(() => {
        if (
            (view === "game" || view === "ended") &&
            session?.gameId &&
            !syncStarted.current
        ) {
            syncStarted.current = true;
            const gameId = session.gameId;
            void loadSync().then((m) => {
                if (syncStarted.current) m.enterGame(gameId);
            });
        }
        if (view !== "game" && view !== "ended" && syncStarted.current) {
            syncStarted.current = false;
            void loadSync().then((m) => m.exitGame());
        }
    }, [view, session?.gameId]);

    if (view === "landing") {
        return <LandingPage initialRoomCode={initialRoomCode} />;
    }

    if (view === "lobby") {
        return (
            <Suspense
                fallback={<div className="fixed inset-0 z-[9999] bg-jetlag" />}
            >
                <GameLobby />
            </Suspense>
        );
    }

    if (view === "ended") {
        return (
            <Suspense fallback={null}>
                <GameEndedOverlay />
            </Suspense>
        );
    }

    // view === "game" → return null, let the map UI render beneath
    return null;
}
