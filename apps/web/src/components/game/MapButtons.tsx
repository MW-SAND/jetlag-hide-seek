import { useStore } from "@nanostores/react";
import { Check, Crosshair, Layers } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

import { SHEET_PEEK_PX } from "@/components/game/GamePanel";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useViewportHeight } from "@/hooks/use-media-query";
import {
    baseTileLayer,
    leafletMapContext,
    thunderforestApiKey,
} from "@/lib/context";
import { TILE_STYLES } from "@/lib/tiles";
import { sheetHeight } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

const fab =
    "glass flex h-11 w-11 items-center justify-center rounded-2xl text-white transition-transform active:scale-95";

/** Locate-me and map-style buttons on the right edge of the map. */
export function MapButtons() {
    const [locating, setLocating] = useState(false);
    const height = useStore(sheetHeight);
    const viewport = useViewportHeight();
    // On phones the buttons ride just above the bottom sheet; hide them when
    // the sheet covers most of the screen.
    const hidden = height > viewport * 0.7;

    const locate = () => {
        const map = leafletMapContext.get();
        if (!map) return;
        if (!("geolocation" in navigator) || !window.isSecureContext) {
            toast.error(
                "Location needs a secure (https) connection on this device.",
            );
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                map.flyTo(
                    [pos.coords.latitude, pos.coords.longitude],
                    Math.max(map.getZoom(), 14),
                );
            },
            () => {
                setLocating(false);
                toast.error("Couldn't get your location.");
            },
            { enableHighAccuracy: true, timeout: 15000 },
        );
    };

    return (
        <div
            className={cn(
                "absolute right-3 z-[1050] flex flex-col gap-2 transition-[bottom,opacity] duration-300 ease-out lg:!bottom-6",
                hidden &&
                    "pointer-events-none opacity-0 lg:pointer-events-auto lg:opacity-100",
            )}
            style={{ bottom: (height || SHEET_PEEK_PX) + 12 }}
        >
            <TileStylePicker />
            <button
                type="button"
                className={fab}
                onClick={locate}
                aria-label="Show my location"
                data-testid="locate-me"
            >
                <Crosshair
                    className={cn(
                        "h-5 w-5",
                        locating && "animate-pulse text-blue-300",
                    )}
                />
            </button>
        </div>
    );
}

function TileStylePicker() {
    const current = useStore(baseTileLayer);
    const apiKey = useStore(thunderforestApiKey);
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={fab}
                    aria-label="Map style"
                    data-testid="map-style"
                >
                    <Layers className="h-5 w-5" />
                </button>
            </PopoverTrigger>
            <PopoverContent side="left" align="end" className="w-64 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Map style
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {TILE_STYLES.filter((s) => !s.needsApiKey || apiKey).map(
                        (style) => (
                            <button
                                key={style.id}
                                type="button"
                                onClick={() => baseTileLayer.set(style.id)}
                                data-testid={`style-${style.id}`}
                                aria-pressed={current === style.id}
                                className={cn(
                                    "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm",
                                    current === style.id
                                        ? "border-primary bg-primary/15 text-white"
                                        : "border-white/10 text-slate-300 hover:bg-white/5",
                                )}
                            >
                                <span
                                    className="h-6 w-6 shrink-0 rounded-md border border-white/20"
                                    style={{ background: style.preview }}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                    {style.label}
                                </span>
                                {current === style.id && (
                                    <Check className="h-4 w-4 text-primary" />
                                )}
                            </button>
                        ),
                    )}
                </div>
                {!apiKey && (
                    <p className="mt-2 text-[11px] text-slate-500">
                        More styles (transit) with a free Thunderforest key in
                        Menu → Map.
                    </p>
                )}
            </PopoverContent>
        </Popover>
    );
}
