/**
 * Build-time prerender of the landing page (see scripts/prerender.mjs), so
 * the first paint comes straight from index.html instead of waiting for JS.
 * Renders the same <App /> tree the client hydrates.
 */
import { renderToString } from "react-dom/server";

import { App } from "./App";

export function render(): string {
    return renderToString(<App />);
}
