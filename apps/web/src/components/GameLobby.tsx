import { useStore } from "@nanostores/react";
import {
    Check,
    Copy,
    Crown,
    Loader2,
    LogOut,
    MapPinned,
    Play,
    Share2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { PlacePicker } from "@/components/PlacePicker";
import { Button } from "@/components/ui/button";
import { mapGeoLocation, polyGeoJSON } from "@/lib/context";
import {
    currentPlayer,
    fetchPlayers,
    gameSession,
    isHost,
    leaveGame,
    multiplayerError,
    type Player,
    players,
    startGame,
    subscribeToGame,
} from "@/lib/multiplayer";
import { inviteLink } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export function GameLobby() {
    const session = useStore(gameSession);
    const allPlayers = useStore(players);
    const amHost = useStore(isHost);
    const me = useStore(currentPlayer);
    const error = useStore(multiplayerError);
    const [ready, setReady] = useState(false);
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        if (!session) return;
        setReady(false);
        // The event stream delivers player and phase changes; it reconnects on
        // its own and always starts with the current version.
        subscribeToGame(session.gameId).then(() => setReady(true));
        fetchPlayers(session.gameId);
    }, [session?.gameId]);

    if (!session) return null;

    const seekers = allPlayers.filter((p) => p.role === "seeker");
    const hiders = allPlayers.filter((p) => p.role === "hider");
    const host = allPlayers.find((p) => p.id === session.hostId);
    const missing =
        allPlayers.length < 2
            ? "Waiting for at least one more player…"
            : hiders.length === 0
              ? "Nobody is hiding yet — someone should join as hider."
              : seekers.length === 0
                ? "Nobody is seeking yet — someone should join as seeker."
                : null;

    const handleStart = async () => {
        setStarting(true);
        await startGame();
        setStarting(false);
    };

    return (
        <div
            className="fixed inset-0 z-[1400] flex flex-col bg-background"
            data-testid="lobby"
        >
            <header className="safe-top flex items-center gap-3 border-b border-white/5 px-4 py-3">
                <Logo className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-semibold leading-tight text-white">
                        Lobby
                    </h1>
                    <p className="truncate text-xs text-slate-400">
                        {amHost
                            ? "You're the host"
                            : host
                              ? `Hosted by ${host.display_name}`
                              : "Getting ready"}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => leaveGame()}
                    aria-label="Leave game"
                >
                    <LogOut />
                    Leave
                </Button>
            </header>

            <main className="scrollbar-thin flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-5">
                    <RoomCodeCard roomCode={session.roomCode} />

                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-3 flex items-center gap-2">
                            <MapPinned className="h-4 w-4 text-blue-300" />
                            <h2 className="text-sm font-semibold text-white">
                                Play area
                            </h2>
                        </div>
                        {amHost ? (
                            <>
                                <PlacePicker />
                                <p className="mt-2 text-xs text-slate-400">
                                    Search a city, region or country. Everyone
                                    gets this area when the game starts.
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-slate-400">
                                The host picks the play area. It appears on your
                                map when the game starts.
                            </p>
                        )}
                    </section>

                    <section
                        className="grid gap-3 sm:grid-cols-2"
                        aria-label="Players"
                    >
                        <Team
                            title="Seekers"
                            tone="blue"
                            members={seekers}
                            hostId={session.hostId}
                            meId={me?.id}
                        />
                        <Team
                            title="Hiders"
                            tone="emerald"
                            members={hiders}
                            hostId={session.hostId}
                            meId={me?.id}
                        />
                    </section>
                </div>
            </main>

            <footer className="safe-bottom border-t border-white/5 bg-slate-950/80 px-4 py-3 backdrop-blur">
                <div className="mx-auto w-full max-w-lg space-y-2">
                    {error && (
                        <p role="alert" className="text-sm text-red-300">
                            {error}
                        </p>
                    )}
                    {amHost ? (
                        <>
                            {missing && (
                                <p className="text-center text-xs text-amber-300/90">
                                    {missing}
                                </p>
                            )}
                            <Button
                                size="lg"
                                className="w-full"
                                onClick={handleStart}
                                disabled={
                                    allPlayers.length < 2 || !ready || starting
                                }
                                data-testid="start-game"
                            >
                                {starting ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <Play />
                                )}
                                Start game
                            </Button>
                        </>
                    ) : (
                        <p className="flex items-center justify-center gap-2 py-3 text-sm text-slate-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Waiting for the host to start…
                        </p>
                    )}
                    <AreaSummary />
                </div>
            </footer>
        </div>
    );
}

function AreaSummary() {
    const amHost = useStore(isHost);
    const location = useStore(mapGeoLocation);
    const poly = useStore(polyGeoJSON);
    if (!amHost) return null;
    const name = poly ? "Custom drawn area" : location?.properties?.name;
    return name ? (
        <p className="text-center text-xs text-slate-500">
            Play area: <span className="text-slate-300">{name}</span>
        </p>
    ) : null;
}

function RoomCodeCard({ roomCode }: { roomCode: string }) {
    const [copied, setCopied] = useState<"code" | "link" | null>(null);
    const link = inviteLink(roomCode);
    const canShare =
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function";

    const copy = async (what: "code" | "link") => {
        try {
            await navigator.clipboard.writeText(
                what === "code" ? roomCode : link,
            );
            setCopied(what);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            window.prompt("Copy this:", what === "code" ? roomCode : link);
        }
    };

    const share = async () => {
        try {
            await navigator.share({
                title: "Join my Hide & Seek game",
                text: `Room code ${roomCode}`,
                url: link,
            });
        } catch {
            /* dismissed */
        }
    };

    return (
        <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/15 via-slate-900 to-emerald-500/10 p-5 text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
                Room code
            </p>
            <button
                type="button"
                onClick={() => copy("code")}
                className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-white"
                aria-label={`Room code ${roomCode}, tap to copy`}
                data-testid="room-code"
            >
                {roomCode}
            </button>
            <div className="mt-4 grid grid-cols-2 gap-2">
                {canShare ? (
                    <Button onClick={share}>
                        <Share2 />
                        Invite
                    </Button>
                ) : (
                    <Button onClick={() => copy("link")}>
                        {copied === "link" ? <Check /> : <Share2 />}
                        {copied === "link" ? "Link copied" : "Copy invite link"}
                    </Button>
                )}
                <Button variant="outline" onClick={() => copy("code")}>
                    {copied === "code" ? <Check /> : <Copy />}
                    {copied === "code" ? "Copied" : "Copy code"}
                </Button>
            </div>
        </section>
    );
}

function Team({
    title,
    tone,
    members,
    hostId,
    meId,
}: {
    title: string;
    tone: "blue" | "emerald";
    members: Player[];
    hostId: string | null;
    meId?: string;
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center justify-between">
                <h2
                    className={cn(
                        "text-sm font-semibold",
                        tone === "blue" ? "text-blue-300" : "text-emerald-300",
                    )}
                >
                    {title}
                </h2>
                <span className="text-xs text-slate-500">{members.length}</span>
            </div>
            {members.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">No one yet</p>
            ) : (
                <ul className="space-y-1.5">
                    {members.map((p) => (
                        <li
                            key={p.id}
                            className="flex items-center gap-2.5"
                            data-testid="lobby-player"
                        >
                            <Avatar name={p.display_name} tone={tone} />
                            <span className="min-w-0 flex-1 truncate text-sm text-white">
                                {p.display_name}
                            </span>
                            {p.id === meId && (
                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                                    You
                                </span>
                            )}
                            {p.id === hostId && (
                                <Crown
                                    className="h-4 w-4 text-amber-300"
                                    aria-label="Host"
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function Avatar({
    name,
    tone,
}: {
    name: string;
    tone: "blue" | "emerald";
}) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                tone === "blue"
                    ? "bg-blue-500/20 text-blue-200"
                    : "bg-emerald-500/20 text-emerald-200",
            )}
        >
            {name.charAt(0).toUpperCase()}
        </span>
    );
}
