import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-600.css";
import "./styles/fonts.css";
import "@fontsource/oxygen/latin-400.css";
import "@fontsource/oxygen/latin-700.css";
import "./styles/globals.css";

import { createRoot, hydrateRoot } from "react-dom/client";

import { App } from "./App";
import { initFromHash } from "./lib/multiplayer";
import { registerServiceWorker } from "./pwa";

const container = document.getElementById("root")!;

// index.html contains the prerendered landing page. Hydrate it (keeping the
// painted DOM) unless a #game/CODE link opens the join form instead.
if (container.hasChildNodes() && !initFromHash()) {
    hydrateRoot(container, <App />);
} else {
    container.textContent = "";
    createRoot(container).render(<App />);
}

registerServiceWorker();
