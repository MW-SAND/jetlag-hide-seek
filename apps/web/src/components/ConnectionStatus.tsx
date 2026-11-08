import { useStore } from "@nanostores/react";
import { Loader2, Wifi, WifiOff } from "lucide-react";

import { gameSession } from "@/lib/multiplayer";
import { realtimeStatus } from "@/lib/multiplayer-sync";

/**
 * Small connection status pill shown during gameplay.
 * Only renders when in a multiplayer game (gameSession is set).
 */
export function ConnectionStatus() {
    const session = useStore(gameSession);
    const status = useStore(realtimeStatus);

    if (!session) return null;

    const config = {
        connected: {
            icon: <Wifi className="w-3 h-3" />,
            label: "Live",
            className:
                "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
        },
        connecting: {
            icon: <Loader2 className="w-3 h-3 animate-spin" />,
            label: "Connecting",
            className: "text-amber-400 bg-amber-400/10 border-amber-400/20",
        },
        disconnected: {
            icon: <WifiOff className="w-3 h-3" />,
            label: "Offline",
            className: "text-red-400 bg-red-400/10 border-red-400/20",
        },
    }[status];

    // Don't show the pill when connected — only show for degraded states
    if (status === "connected") return null;

    return (
        <div
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium ${config.className}`}
            title={
                status === "disconnected"
                    ? "Realtime connection lost — changes may not sync"
                    : "Establishing realtime connection..."
            }
        >
            {config.icon}
            {config.label}
        </div>
    );
}
