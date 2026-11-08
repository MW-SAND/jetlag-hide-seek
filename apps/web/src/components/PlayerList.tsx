import { useStore } from "@nanostores/react";
import {
    ChevronDown,
    ChevronUp,
    Crown,
    Globe,
    MapPin,
    OctagonX,
    Users,
} from "lucide-react";
import { useState } from "react";

import {
    endGame,
    gameSession,
    isHost,
    type Player,
    players,
} from "@/lib/multiplayer";

/**
 * Compact floating player list shown during gameplay.
 * Collapsed by default — shows count badge. Expands to full list on click.
 */
export function PlayerList() {
    const session = useStore(gameSession);
    const allPlayers = useStore(players);
    const amHost = useStore(isHost);
    const [expanded, setExpanded] = useState(false);

    if (!session || allPlayers.length === 0) return null;

    const hiders = allPlayers.filter((p) => p.role === "hider");
    const seekers = allPlayers.filter((p) => p.role === "seeker");

    return (
        <div className="absolute top-[72px] md:top-2 right-12 z-[1030]">
            <div className="bg-jetlag/90 backdrop-blur-sm border border-white/10 rounded-lg shadow-lg overflow-hidden min-w-[160px]">
                {/* Header — always visible */}
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
                >
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-300">
                        {allPlayers.length} player
                        {allPlayers.length !== 1 ? "s" : ""}
                    </span>
                    <span className="ml-auto text-slate-500">
                        {expanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                        )}
                    </span>
                </button>

                {/* Expanded player list */}
                {expanded && (
                    <div className="border-t border-white/5 max-h-60 overflow-y-auto">
                        {hiders.length > 0 && (
                            <>
                                <div className="px-3 py-1 bg-white/[0.02]">
                                    <span className="text-[10px] uppercase tracking-wider text-emerald-400/60 font-medium">
                                        Hiders
                                    </span>
                                </div>
                                {hiders.map((p) => (
                                    <PlayerRow
                                        key={p.id}
                                        player={p}
                                        isMe={p.id === session.playerId}
                                        isHost={p.id === session.hostId}
                                    />
                                ))}
                            </>
                        )}
                        {seekers.length > 0 && (
                            <>
                                <div className="px-3 py-1 bg-white/[0.02]">
                                    <span className="text-[10px] uppercase tracking-wider text-blue-400/60 font-medium">
                                        Seekers
                                    </span>
                                </div>
                                {seekers.map((p) => (
                                    <PlayerRow
                                        key={p.id}
                                        player={p}
                                        isMe={p.id === session.playerId}
                                        isHost={p.id === session.hostId}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                )}

                {/* End Game (host only) */}
                {expanded && amHost && (
                    <div className="border-t border-white/5 px-3 py-2">
                        <button
                            onClick={() => endGame()}
                            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <OctagonX className="w-3.5 h-3.5" />
                            End Game
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function PlayerRow({
    player,
    isMe,
    isHost,
}: {
    player: Player;
    isMe: boolean;
    isHost: boolean;
}) {
    const RoleIcon = player.role === "hider" ? Globe : MapPin;
    const roleColor =
        player.role === "hider" ? "text-emerald-400" : "text-blue-400";

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <RoleIcon className={`w-3 h-3 ${roleColor} opacity-50`} />
            <span
                className={`truncate ${isMe ? "text-white font-medium" : "text-slate-400"}`}
            >
                {player.display_name}
            </span>
            {isMe && (
                <span className="text-[9px] px-1 rounded bg-white/10 text-slate-500">
                    you
                </span>
            )}
            {isHost && <Crown className="w-3 h-3 text-amber-400/70" />}
        </div>
    );
}
