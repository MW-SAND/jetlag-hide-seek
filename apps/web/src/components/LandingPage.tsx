import type { PlayerRole } from "@jetlag/shared";
import { useStore } from "@nanostores/react";
import { Globe, MapPin, Plus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { RawInput } from "@/components/ui/input";
import {
    createGame,
    joinGame,
    multiplayerError,
    multiplayerLoading,
    rejoinGame,
} from "@/lib/multiplayer";

type Mode = null | "create" | "join";

export function LandingPage({ initialRoomCode }: { initialRoomCode?: string }) {
    const error = useStore(multiplayerError);
    const loading = useStore(multiplayerLoading);

    const [mode, setMode] = useState<Mode>(initialRoomCode ? "join" : null);
    const [displayName, setDisplayName] = useState("");
    const [roomCode, setRoomCode] = useState(initialRoomCode ?? "");
    const [role, setRole] = useState<PlayerRole>("seeker");

    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (mode && nameInputRef.current) {
            nameInputRef.current.focus();
        }
    }, [mode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!displayName.trim()) return;

        if (mode === "create") {
            await createGame(displayName.trim(), role);
        } else if (mode === "join") {
            if (!roomCode.trim()) return;

            // First try to rejoin an existing player session for this browser.
            // If no matching player exists, fall back to a normal join.
            const rejoined = await rejoinGame(roomCode.trim());
            if (rejoined) return;

            await joinGame(roomCode.trim(), displayName.trim(), role);
        }
    };

    const formatRoomCode = (value: string) => {
        return value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 6);
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-jetlag flex flex-col items-center justify-center p-4 overflow-hidden overflow-y-auto">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl" />
                {/* Grid lines */}
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

            <div className="relative z-10 w-full max-w-md">
                {/* Logo / Title */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm mb-5 border border-white/10">
                        <Globe className="w-8 h-8 text-blue-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-white font-[Poppins] tracking-tight">
                        Jet Lag
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm tracking-wide uppercase">
                        Hide &amp; Seek Map Generator
                    </p>
                </div>

                {/* Mode selection */}
                {mode === null && (
                    <div className="space-y-3 animate-in fade-in duration-300">
                        <button
                            onClick={() => setMode("create")}
                            className="w-full group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 text-left transition-all hover:bg-white/10 hover:border-white/20"
                        >
                            <div className="flex items-center gap-4">
                                <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                    <Plus className="w-5 h-5 text-blue-400" />
                                </div>
                                <div>
                                    <div className="font-semibold text-white text-base">
                                        Create Game
                                    </div>
                                    <div className="text-slate-400 text-sm mt-0.5">
                                        Start a new session &amp; share the code
                                    </div>
                                </div>
                            </div>
                        </button>

                        <button
                            onClick={() => setMode("join")}
                            className="w-full group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 text-left transition-all hover:bg-white/10 hover:border-white/20"
                        >
                            <div className="flex items-center gap-4">
                                <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                    <Users className="w-5 h-5 text-emerald-400" />
                                </div>
                                <div>
                                    <div className="font-semibold text-white text-base">
                                        Join Game
                                    </div>
                                    <div className="text-slate-400 text-sm mt-0.5">
                                        Enter a room code to join
                                    </div>
                                </div>
                            </div>
                        </button>
                    </div>
                )}

                {/* Create / Join form */}
                {mode !== null && (
                    <form
                        onSubmit={handleSubmit}
                        className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                    >
                        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 space-y-4">
                            <h2 className="font-semibold text-white text-lg flex items-center gap-2">
                                {mode === "create" ? (
                                    <>
                                        <Plus className="w-4 h-4 text-blue-400" />
                                        Create Game
                                    </>
                                ) : (
                                    <>
                                        <Users className="w-4 h-4 text-emerald-400" />
                                        Join Game
                                    </>
                                )}
                            </h2>

                            {/* Room code (join only) */}
                            {mode === "join" && (
                                <div>
                                    <label className="text-sm text-slate-400 mb-1.5 block">
                                        Room Code
                                    </label>
                                    <RawInput
                                        value={roomCode}
                                        onChange={(e) =>
                                            setRoomCode(
                                                formatRoomCode(e.target.value),
                                            )
                                        }
                                        placeholder="ABC123"
                                        maxLength={6}
                                        className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 text-center text-2xl tracking-[0.3em] font-mono h-14 uppercase"
                                        autoFocus={!!initialRoomCode}
                                    />
                                </div>
                            )}

                            {/* Display name */}
                            <div>
                                <label className="text-sm text-slate-400 mb-1.5 block">
                                    Your Name
                                </label>
                                <RawInput
                                    ref={nameInputRef}
                                    value={displayName}
                                    onChange={(e) =>
                                        setDisplayName(
                                            e.target.value.slice(0, 20),
                                        )
                                    }
                                    placeholder="Enter your name"
                                    maxLength={20}
                                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
                                />
                            </div>

                            {/* Role selection (create + join) */}
                            {mode !== null && (
                                <div>
                                    <label className="text-sm text-slate-400 mb-1.5 block">
                                        Your Role
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setRole("seeker")}
                                            className={`rounded-lg border p-3 text-sm font-medium transition-all ${
                                                role === "seeker"
                                                    ? "border-blue-500 bg-blue-500/20 text-blue-300"
                                                    : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"
                                            }`}
                                        >
                                            <MapPin className="w-4 h-4 mx-auto mb-1" />
                                            Seeker
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRole("hider")}
                                            className={`rounded-lg border p-3 text-sm font-medium transition-all ${
                                                role === "hider"
                                                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                                                    : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"
                                            }`}
                                        >
                                            <Globe className="w-4 h-4 mx-auto mb-1" />
                                            Hider
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-red-300 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    setMode(null);
                                    multiplayerError.set(null);
                                }}
                                className="text-slate-400 hover:text-white"
                                disabled={loading}
                            >
                                Back
                            </Button>
                            <Button
                                type="submit"
                                disabled={
                                    loading ||
                                    !displayName.trim() ||
                                    (mode === "join" && roomCode.length !== 6)
                                }
                                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
                            >
                                {loading
                                    ? "Connecting..."
                                    : mode === "create"
                                      ? "Create Game"
                                      : "Join Game"}
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
