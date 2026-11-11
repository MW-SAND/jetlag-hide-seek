import { useStore } from "@nanostores/react";
import { Check, Crown, Loader2, Menu, Users } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/GameLobby";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { isLoading, mapGeoLocation, polyGeoJSON } from "@/lib/context";
import { currentPlayer, gameSession, players } from "@/lib/multiplayer";
import { realtimeStatus } from "@/lib/multiplayer-sync";
import { inviteLink } from "@/lib/preferences";
import { loadingMessages, menuOpen } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/** Floating top bar: menu, area + room code, players and connection. */
export function TopBar() {
    const session = useStore(gameSession);
    const location = useStore(mapGeoLocation);
    const poly = useStore(polyGeoJSON);
    const loading = useStore(isLoading);
    const messages = useStore(loadingMessages);
    const [copied, setCopied] = useState(false);

    if (!session) return null;
    const area = poly
        ? "Custom area"
        : (location?.properties?.name ?? "Play area");
    const loadingText = Object.values(messages).at(-1);

    const copyInvite = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink(session.roomCode));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard unavailable (http): the code is visible anyway */
        }
    };

    return (
        <>
            <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[1100] flex items-center gap-2 px-3 pt-3">
                <Button
                    size="icon"
                    variant="ghost"
                    className="glass pointer-events-auto rounded-2xl"
                    onClick={() => menuOpen.set(true)}
                    aria-label="Open menu"
                    data-testid="open-menu"
                >
                    <Menu className="!h-5 !w-5" />
                </Button>
                <button
                    type="button"
                    onClick={copyInvite}
                    className="glass pointer-events-auto flex h-11 min-w-0 flex-1 flex-col justify-center rounded-2xl px-3 text-left lg:max-w-sm"
                    aria-label={`Room ${session.roomCode}. Tap to copy the invite link.`}
                    data-testid="top-room"
                >
                    <span
                        className="truncate text-sm font-semibold leading-tight text-white"
                        data-testid="area-name"
                    >
                        {area}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] leading-tight text-slate-400">
                        {copied ? (
                            <>
                                <Check className="h-3 w-3 text-emerald-400" />{" "}
                                Invite link copied
                            </>
                        ) : (
                            <>
                                Room{" "}
                                <span className="font-mono tracking-wider text-slate-200">
                                    {session.roomCode}
                                </span>
                            </>
                        )}
                    </span>
                </button>
                <PlayersButton />
            </div>
            {(loading || loadingText) && (
                <div
                    className="glass pointer-events-none absolute left-1/2 top-[68px] z-[1100] flex max-w-[80vw] -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs text-slate-200 lg:left-[calc(50%+200px)]"
                    role="status"
                    data-testid="map-updating"
                >
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span className="truncate">
                        {loadingText ?? "Updating map…"}
                    </span>
                </div>
            )}
        </>
    );
}

function PlayersButton() {
    const all = useStore(players);
    const session = useStore(gameSession);
    const me = useStore(currentPlayer);
    const status = useStore(realtimeStatus);
    const dot =
        status === "connected"
            ? "bg-emerald-400"
            : status === "connecting"
              ? "bg-amber-400"
              : "bg-red-500";
    const label =
        status === "connected"
            ? "Live"
            : status === "connecting"
              ? "Connecting…"
              : "Offline — reconnecting";

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="glass pointer-events-auto relative flex h-11 items-center gap-1.5 rounded-2xl px-3 text-sm font-semibold text-white"
                    aria-label={`${all.length} players, ${label}`}
                    data-testid="players-button"
                >
                    <Users className="h-4 w-4" />
                    {all.length}
                    <span
                        className={cn(
                            "absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900",
                            dot,
                        )}
                        data-testid="connection-dot"
                        data-status={status}
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <p className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                    <span className={cn("h-2 w-2 rounded-full", dot)} />
                    {label}
                </p>
                {(["seeker", "hider"] as const).map((role) => {
                    const members = all.filter((p) => p.role === role);
                    return (
                        <div key={role} className="mb-3 last:mb-0">
                            <p
                                className={cn(
                                    "mb-1.5 text-xs font-semibold uppercase tracking-wider",
                                    role === "seeker"
                                        ? "text-blue-300"
                                        : "text-emerald-300",
                                )}
                            >
                                {role === "seeker" ? "Seekers" : "Hiders"} ·{" "}
                                {members.length}
                            </p>
                            <ul className="space-y-1.5">
                                {members.map((p) => (
                                    <li
                                        key={p.id}
                                        className="flex items-center gap-2"
                                    >
                                        <Avatar
                                            name={p.display_name}
                                            tone={
                                                role === "seeker"
                                                    ? "blue"
                                                    : "emerald"
                                            }
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {p.display_name}
                                        </span>
                                        {p.id === me?.id && (
                                            <span className="text-[10px] uppercase text-slate-400">
                                                You
                                            </span>
                                        )}
                                        {p.id === session?.hostId && (
                                            <Crown className="h-4 w-4 text-amber-300" />
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}
