import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() =>
        typeof window === "undefined"
            ? false
            : window.matchMedia(query).matches,
    );
    useEffect(() => {
        const mql = window.matchMedia(query);
        const update = () => setMatches(mql.matches);
        update();
        mql.addEventListener("change", update);
        return () => mql.removeEventListener("change", update);
    }, [query]);
    return matches;
}

export const DESKTOP_QUERY = "(min-width: 1024px)";

export function useViewportHeight(): number {
    const [height, setHeight] = useState(() =>
        typeof window === "undefined"
            ? 800
            : (window.visualViewport?.height ?? window.innerHeight),
    );
    useEffect(() => {
        const update = () =>
            setHeight(window.visualViewport?.height ?? window.innerHeight);
        window.addEventListener("resize", update);
        window.visualViewport?.addEventListener("resize", update);
        return () => {
            window.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("resize", update);
        };
    }, []);
    return height;
}
