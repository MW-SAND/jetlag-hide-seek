import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker() {
    if (import.meta.env.DEV) return;
    registerSW({
        // Don't force-claim open tabs: the new version activates on next load.
        onOfflineReady() {
            console.info("Ready to work offline");
        },
    });
}
