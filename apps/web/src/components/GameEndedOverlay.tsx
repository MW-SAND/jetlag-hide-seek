import { useStore } from "@nanostores/react";
import { Home, Map as MapIcon, Trophy } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { Avatar } from "@/components/GameLobby";
import { Button } from "@/components/ui/button";
import { gameSession, leaveGame, players } from "@/lib/multiplayer";
import { committedQuestions } from "@/lib/question-store";

export function GameEndedOverlay() {
    const session = useStore(gameSession);
    const allPlayers = useStore(players);
    const questions = useStore(committedQuestions);
    const [viewingMap, setViewingMap] = useState(false);

    if (!session) return null;

    if (viewingMap) {
        return (
            <div className="safe-bottom fixed inset-x-0 bottom-0 z-[1400] flex justify-center p-3">
                <div className="glass flex w-full max-w-md items-center gap-2 rounded-2xl p-2 pl-4">
                    <span className="flex-1 text-sm font-semibold text-white">
                        Game over
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setViewingMap(false)}
                    >
                        Summary
                    </Button>
                    <Button
                        size="sm"
                        onClick={leaveGame}
                        data-testid="ended-home"
                    >
                        <Home />
                        Home
                    </Button>
                </div>
            </div>
        );
    }

    const answered = questions.filter((q) => q.answer !== null).length;
    const vetoed = questions.filter(
        (q) => q.veto !== null && q.veto !== undefined,
    ).length;
    const sorted = [...allPlayers].sort((a, b) =>
        a.role === b.role ? 0 : a.role === "hider" ? -1 : 1,
    );

    return (
        <div
            className="fixed inset-0 z-[1400] flex flex-col overflow-y-auto bg-background/95 backdrop-blur-sm"
            data-testid="game-ended"
        >
            <div className="safe-top safe-bottom mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-8">
                <Logo className="self-center" />
                <div className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-500/15">
                        <Trophy className="h-8 w-8 text-amber-300" />
                    </div>
                    <h1 className="text-3xl font-bold text-white">Game over</h1>
                    <p className="mt-1 text-sm text-slate-400">
                        Room {session.roomCode}
                    </p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <Stat value={questions.length} label="Asked" />
                    <Stat
                        value={answered}
                        label="Answered"
                        tone="text-emerald-300"
                    />
                    <Stat value={vetoed} label="Vetoed" tone="text-amber-300" />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
                    {sorted.map((p) => (
                        <div
                            key={p.id}
                            className="flex items-center gap-3 rounded-xl px-2 py-2"
                        >
                            <Avatar
                                name={p.display_name}
                                tone={p.role === "hider" ? "emerald" : "blue"}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-white">
                                {p.display_name}
                            </span>
                            <span
                                className={
                                    p.role === "hider"
                                        ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300"
                                        : "rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-300"
                                }
                            >
                                {p.role === "hider" ? "Hider" : "Seeker"}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="mt-auto flex flex-col gap-2">
                    <Button
                        size="lg"
                        onClick={leaveGame}
                        data-testid="ended-home"
                    >
                        <Home />
                        Back to home
                    </Button>
                    <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setViewingMap(true)}
                        data-testid="ended-view-map"
                    >
                        <MapIcon />
                        View final map
                    </Button>
                </div>
            </div>
        </div>
    );
}

function Stat({
    value,
    label,
    tone = "text-white",
}: {
    value: number;
    label: string;
    tone?: string;
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-3 text-center">
            <div className={`text-2xl font-bold tabular-nums ${tone}`}>
                {value}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
                {label}
            </div>
        </div>
    );
}
