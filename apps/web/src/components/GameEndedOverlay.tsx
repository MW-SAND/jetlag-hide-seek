import { useStore } from "@nanostores/react";
import { Flag, Home, MapPin, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { gameSession, leaveGame, players } from "@/lib/multiplayer";
import { committedQuestions } from "@/lib/question-store";

export function GameEndedOverlay() {
    const session = useStore(gameSession);
    const allPlayers = useStore(players);
    const questions = useStore(committedQuestions);

    if (!session) return null;

    const answered = questions.filter((q) => q.answer !== null);
    const hiders = allPlayers.filter((p) => p.role === "hider");
    const seekers = allPlayers.filter((p) => p.role === "seeker");

    return (
        <div className="fixed inset-0 z-[1050] bg-jetlag/95 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-5 animate-in fade-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/15 mb-4">
                        <Trophy className="w-7 h-7 text-amber-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-white font-[Poppins]">
                        Game Over
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Room {session.roomCode}
                    </p>
                </div>

                {/* Stats */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                            <div className="text-xl font-bold text-white">
                                {questions.length}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">
                                Questions
                            </div>
                        </div>
                        <div>
                            <div className="text-xl font-bold text-emerald-400">
                                {answered.length}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">
                                Answered
                            </div>
                        </div>
                        <div>
                            <div className="text-xl font-bold text-blue-400">
                                {allPlayers.length}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-500">
                                Players
                            </div>
                        </div>
                    </div>

                    {/* Player list */}
                    <div className="border-t border-white/5 pt-3 space-y-1.5">
                        {hiders.map((p) => (
                            <div
                                key={p.id}
                                className="flex items-center gap-2 text-sm"
                            >
                                <MapPin className="w-3.5 h-3.5 text-emerald-400/50" />
                                <span className="text-slate-300">
                                    {p.display_name}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 ml-auto">
                                    hider
                                </span>
                            </div>
                        ))}
                        {seekers.map((p) => (
                            <div
                                key={p.id}
                                className="flex items-center gap-2 text-sm"
                            >
                                <Flag className="w-3.5 h-3.5 text-blue-400/50" />
                                <span className="text-slate-300">
                                    {p.display_name}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 ml-auto">
                                    seeker
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Actions */}
                <Button
                    onClick={leaveGame}
                    className="w-full bg-white/10 hover:bg-white/15 text-white gap-2 border border-white/10"
                >
                    <Home className="w-4 h-4" />
                    Back to Home
                </Button>
            </div>
        </div>
    );
}
