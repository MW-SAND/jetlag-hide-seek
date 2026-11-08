/**
 * Mounts all multiplayer overlay components inside a single error boundary.
 * Used in index.astro so that one `client:only` hydration point covers:
 *   - AppRoot (view router)
 *   - GameUIVisibility (show/hide map UI)
 */
import { AppRoot } from "./AppRoot";
import { GameUIVisibility } from "./GameUIVisibility";
import { MultiplayerErrorBoundary } from "./MultiplayerErrorBoundary";

export function MultiplayerOverlay() {
    return (
        <MultiplayerErrorBoundary>
            <AppRoot />
            <GameUIVisibility />
        </MultiplayerErrorBoundary>
    );
}
