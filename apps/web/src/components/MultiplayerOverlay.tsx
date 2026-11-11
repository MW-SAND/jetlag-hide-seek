/**
 * Mounts the multiplayer overlay screens (landing, lobby, results) inside a
 * single error boundary.
 */
import { AppRoot } from "./AppRoot";
import { MultiplayerErrorBoundary } from "./MultiplayerErrorBoundary";

export function MultiplayerOverlay() {
    return (
        <MultiplayerErrorBoundary>
            <AppRoot />
        </MultiplayerErrorBoundary>
    );
}
