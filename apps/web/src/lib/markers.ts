import { ICON_COLORS } from "@jetlag/geo/api/constants";

/**
 * Coloured map pins as inline SVG (same shape and size as Leaflet's default
 * marker), so no marker images are fetched from third-party hosts.
 */
const cache = new Map<string, string>();

export function markerIconUrl(color: keyof typeof ICON_COLORS): string {
    let url = cache.get(color);
    if (url) return url;
    const fill = ICON_COLORS[color] ?? ICON_COLORS.blue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="82" viewBox="0 0 25 41"><path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${fill}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/><circle cx="12.5" cy="12.5" r="4.6" fill="#fff" fill-opacity="0.9"/></svg>`;
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    cache.set(color, url);
    return url;
}

export const MARKER_SHADOW_URL = "/marker-shadow.png";
