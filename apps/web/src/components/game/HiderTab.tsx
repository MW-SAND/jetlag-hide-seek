import { useStore } from "@nanostores/react";
import { Crosshair, MapPin } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

import { HiderAnswerPanel } from "@/components/HiderAnswerPanel";
import { Button } from "@/components/ui/button";
import { hiderMode, leafletMapContext } from "@/lib/context";

/** Hider's tab: where am I hiding + questions waiting for an answer. */
export function HiderTab() {
    const $hiderMode = useStore(hiderMode);
    const [locating, setLocating] = useState(false);

    const useGps = () => {
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
                hiderMode.set({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                });
                leafletMapContext
                    .get()
                    ?.flyTo([pos.coords.latitude, pos.coords.longitude], 14);
                toast.success("Hiding spot set to your location", {
                    autoClose: 1500,
                });
            },
            () => {
                setLocating(false);
                toast.error("Couldn't get your location.");
            },
            { enableHighAccuracy: true, timeout: 15000 },
        );
    };

    return (
        <div className="space-y-4">
            <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3.5">
                <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white">
                            Your hiding spot
                        </h3>
                        <p className="text-xs text-slate-300">
                            {$hiderMode
                                ? `${$hiderMode.latitude.toFixed(5)}, ${$hiderMode.longitude.toFixed(5)} · drag the pin to move it`
                                : "Not set yet"}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                            Only hiders can see this.
                        </p>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const c = leafletMapContext.get()?.getCenter();
                            if (!c) return;
                            hiderMode.set({
                                latitude: c.lat,
                                longitude: c.lng,
                            });
                            toast.success(
                                "Hiding spot moved to the map centre",
                                { autoClose: 1500 },
                            );
                        }}
                        data-testid="hider-map-centre"
                    >
                        <MapPin />
                        Map centre
                    </Button>
                    <Button
                        variant="hider"
                        size="sm"
                        onClick={useGps}
                        disabled={locating}
                        data-testid="hider-use-gps"
                    >
                        <Crosshair />
                        {locating ? "Locating…" : "My location"}
                    </Button>
                </div>
            </section>
            <HiderAnswerPanel />
        </div>
    );
}
