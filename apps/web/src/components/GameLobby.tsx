import { useStore } from "@nanostores/react";
import {
    Check,
    Copy,
    Crown,
    Globe,
    LogOut,
    MapPin,
    Play,
    Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    fetchPlayers,
    gameSession,
    isHost,
    leaveGame,
    type Player,
    players,
    startGame,
    subscribeToGame,
} from "@/lib/multiplayer";

export function GameLobby() {
    const session = useStore(gameSession);
    const allPlayers = useStore(players);
    const amHost = useStore(isHost);
    const [copied, setCopied] = useState(false);
    const [subscribed, setSubscribed] = useState(false);

    useEffect(() => {
        if (!session) return;
        setSubscribed(false);
        // The event stream delivers player and phase changes; it reconnects on
        // its own and always starts with the current version.
        subscribeToGame(session.gameId).then(() => setSubscribed(true));
        fetchPlayers(session.gameId);
    }, [session?.gameId]);

    if (!session) return null;

    const hiders = allPlayers.filter((p) => p.role === "hider");
    const seekers = allPlayers.filter((p) => p.role === "seeker");

    const copyCode = async () => {
        await navigator.clipboard.writeText(session.roomCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleStart = async () => {
        await startGame();
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-jetlag flex flex-col items-center justify-center p-4 overflow-hidden overflow-y-auto">
            {/* Background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/3 -left-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/3 -right-20 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl" />
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `
                            linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)
                        `,
                        backgroundSize: "60px 60px",
                    }}
                />
            </div>

            <div className="relative z-10 w-full max-w-md space-y-4">
                {/* Room code header */}
                <div className="text-center">
                    <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                        Room Code
                    </p>
                    <button
                        onClick={copyCode}
                        className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group"
                    >
                        <span className="text-3xl font-mono font-bold text-white tracking-[0.25em]">
                            {session.roomCode}
                        </span>
                        {copied ? (
                            <Check className="w-5 h-5 text-emerald-400" />
                        ) : (
                            <Copy className="w-5 h-5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                        )}
                    </button>
                    <p className="text-slate-500 text-xs mt-2">
                        {copied
                            ? "Copied!"
                            : "Share this code with other players"}
                    </p>
                </div>

                {/* Player list */}
                <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                            <Users className="w-4 h-4" />
                            Players
                        </div>
                        <span className="text-xs text-slate-500">
                            {allPlayers.length} joined
                        </span>
                    </div>

                    {/* Hiders */}
                    {hiders.length > 0 && (
                        <div>
                            <div className="px-4 py-1.5 bg-white/[0.02]">
                                <span className="text-xs uppercase tracking-wider text-emerald-400/70 font-medium">
                                    Hiders
                                </span>
                            </div>
                            {hiders.map((p) => (
                                <PlayerRow
                                    key={p.id}
                                    player={p}
                                    isCurrentUser={p.id === session.playerId}
                                    isHost={p.id === session.hostId}
                                />
                            ))}
                        </div>
                    )}

                    {/* Seekers */}
                    {seekers.length > 0 && (
                        <div>
                            <div className="px-4 py-1.5 bg-white/[0.02]">
                                <span className="text-xs uppercase tracking-wider text-blue-400/70 font-medium">
                                    Seekers
                                </span>
                            </div>
                            {seekers.map((p) => (
                                <PlayerRow
                                    key={p.id}
                                    player={p}
                                    isCurrentUser={p.id === session.playerId}
                                    isHost={p.id === session.hostId}
                                />
                            ))}
                        </div>
                    )}

                    {allPlayers.length === 0 && (
                        <div className="px-4 py-8 text-center text-slate-500 text-sm">
                            Waiting for players...
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        onClick={leaveGame}
                        className="text-slate-400 hover:text-white gap-1.5"
                    >
                        <LogOut className="w-4 h-4" />
                        Leave
                    </Button>

                    {amHost && (
                        <Button
                            onClick={handleStart}
                            disabled={allPlayers.length < 2 || !subscribed}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white gap-2"
                        >
                            <Play className="w-4 h-4" />
                            {subscribed ? "Start Game" : "Connecting..."}
                        </Button>
                    )}

                    {!amHost && (
                        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
                            {subscribed
                                ? "Waiting for host to start..."
                                : "Connecting..."}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PlayerRow({
    player,
    isCurrentUser,
    isHost,
}: {
    player: Player;
    isCurrentUser: boolean;
    isHost: boolean;
}) {
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-b-0">
            <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    player.role === "hider"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-blue-500/20 text-blue-400"
                }`}
            >
                {player.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span
                        className={`text-sm font-medium truncate ${
                            isCurrentUser ? "text-white" : "text-slate-300"
                        }`}
                    >
                        {player.display_name}
                    </span>
                    {isCurrentUser && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
                            you
                        </span>
                    )}
                    {isHost && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                </div>
            </div>
            {player.role === "hider" ? (
                <Globe className="w-3.5 h-3.5 text-emerald-500/50" />
            ) : (
                <MapPin className="w-3.5 h-3.5 text-blue-500/50" />
            )}
        </div>
    );
}
