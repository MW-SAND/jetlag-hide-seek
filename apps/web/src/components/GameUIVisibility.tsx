/**
 * Previously toggled #game-ui visibility. Now a no-op: the app-root-container
 * is a fixed pointer-events-none overlay, so the game UI is always visible and
 * Leaflet initialises on a real-sized element from the start.
 */
export function GameUIVisibility() {
    return null;
}
