import { DISPLAY_NAME_MAX, type PlayerRole } from "@jetlag/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand/Logo";
import { RolePicker, SubmitIcon } from "@/components/RolePicker";
import { Button } from "@/components/ui/button";
import { RawInput } from "@/components/ui/input";
import {
    createGame,
    joinGame,
    multiplayerError,
    multiplayerLoading,
    rejoinGame,
} from "@/lib/multiplayer";
import {
    forgetRoom,
    isKnownRoom,
    loadRememberedName,
    rememberName,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Mode = "create" | "join";

/** Accepts a typed/pasted code ("abc-123") or a whole invite link. */
const formatRoomCode = (value: string) =>
    (value.match(/#game\/([A-Za-z0-9]{6})/)?.[1] ?? value)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);

export function LandingPage({ initialRoomCode }: { initialRoomCode?: string }) {
    const error = useStore(multiplayerError);
    const loading = useStore(multiplayerLoading);

    const [mode, setMode] = useState<Mode>(initialRoomCode ? "join" : "create");
    const [displayName, setDisplayName] = useState("");
    const [roomCode, setRoomCode] = useState(initialRoomCode ?? "");
    const [role, setRole] = useState<PlayerRole>("seeker");
    const [reconnecting, setReconnecting] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);
    const codeRef = useRef<HTMLInputElement>(null);

    // Coming back to a game this browser is already in (e.g. after a refresh):
    // reconnect straight away instead of showing the form.
    useEffect(() => {
        if (!initialRoomCode || !isKnownRoom(initialRoomCode)) return;
        setReconnecting(true);
        void rejoinGame(initialRoomCode).then((ok) => {
            if (ok) return;
            forgetRoom(initialRoomCode);
            setReconnecting(false);
        });
    }, [initialRoomCode]);

    // Restore the last used name after hydration (the HTML is prerendered).
    useEffect(() => {
        const remembered = loadRememberedName();
        if (remembered) setDisplayName(remembered);
    }, []);

    const canSubmit =
        displayName.trim().length > 0 &&
        (mode === "create" || roomCode.length === 6);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) {
            (displayName.trim() ? codeRef : nameRef).current?.focus();
            multiplayerError.set(
                displayName.trim()
                    ? "Enter the 6-character room code."
                    : "Enter your name first.",
            );
            return;
        }
        const name = displayName.trim();
        rememberName(name);
        if (mode === "create") {
            await createGame(name, role);
            return;
        }
        // A returning player (same browser) goes straight back in.
        if (isKnownRoom(roomCode) && (await rejoinGame(roomCode))) return;
        await joinGame(roomCode, name, role);
    };

    return (
        <div className="fixed inset-0 z-[1400] overflow-y-auto bg-background">
            {reconnecting && (
                <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background"
                    role="status"
                    data-testid="reconnecting"
                >
                    <Logo />
                    <p className="text-sm text-slate-300">
                        Reconnecting to room{" "}
                        <span className="font-mono tracking-wider text-white">
                            {initialRoomCode}
                        </span>
                        …
                    </p>
                </div>
            )}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_10%_-10%,rgba(59,130,246,0.18),transparent),radial-gradient(50rem_35rem_at_110%_110%,rgba(16,185,129,0.14),transparent)]"
            />
            <main className="safe-top safe-bottom relative mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-5 py-10">
                <header className="mb-8 flex items-center gap-3">
                    <Logo />
                    <div>
                        <h1 className="text-2xl font-bold leading-tight tracking-tight text-white">
                            Hide &amp; Seek
                        </h1>
                        <p className="text-sm text-slate-400">
                            The map companion for Jet Lag: The Game
                        </p>
                    </div>
                </header>

                <form
                    onSubmit={handleSubmit}
                    className="space-y-5 rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/40 backdrop-blur-xl"
                    noValidate
                >
                    <div
                        role="tablist"
                        aria-label="Start or join"
                        className="grid grid-cols-2 rounded-xl bg-white/5 p-1"
                    >
                        {(["create", "join"] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                role="tab"
                                aria-selected={mode === m}
                                data-testid={`tab-${m}`}
                                onClick={() => {
                                    setMode(m);
                                    multiplayerError.set(null);
                                }}
                                className={cn(
                                    "h-10 rounded-lg text-sm font-semibold transition-colors",
                                    mode === m
                                        ? "bg-white text-slate-900 shadow"
                                        : "text-slate-400 hover:text-white",
                                )}
                            >
                                {m === "create" ? "New game" : "Join game"}
                            </button>
                        ))}
                    </div>

                    {mode === "join" && (
                        <label className="block">
                            <span className="mb-1.5 block text-sm font-medium text-slate-300">
                                Room code
                            </span>
                            <RawInput
                                ref={codeRef}
                                value={roomCode}
                                onChange={(e) =>
                                    setRoomCode(formatRoomCode(e.target.value))
                                }
                                placeholder="ABC123"
                                inputMode="text"
                                autoCapitalize="characters"
                                autoComplete="off"
                                spellCheck={false}
                                aria-label="Room code"
                                className="h-14 text-center font-mono text-2xl uppercase tracking-[0.35em]"
                            />
                        </label>
                    )}

                    <label className="block">
                        <span className="mb-1.5 block text-sm font-medium text-slate-300">
                            Your name
                        </span>
                        <RawInput
                            ref={nameRef}
                            value={displayName}
                            onChange={(e) =>
                                setDisplayName(
                                    e.target.value.slice(0, DISPLAY_NAME_MAX),
                                )
                            }
                            placeholder="Enter your name"
                            autoComplete="nickname"
                            maxLength={DISPLAY_NAME_MAX}
                            aria-label="Your name"
                        />
                    </label>

                    <div>
                        <span className="mb-1.5 block text-sm font-medium text-slate-300">
                            I&apos;m a
                        </span>
                        <RolePicker value={role} onChange={setRole} />
                    </div>

                    {error && (
                        <p
                            role="alert"
                            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200"
                        >
                            {error}
                        </p>
                    )}

                    <Button
                        type="submit"
                        size="lg"
                        className="w-full"
                        disabled={loading}
                        data-testid="landing-submit"
                    >
                        <SubmitIcon loading={loading} mode={mode} />
                        {mode === "create" ? "Create game" : "Join game"}
                    </Button>
                </form>

                <p className="mt-6 text-center text-xs text-slate-500">
                    Create a game, share the code, and everyone plays on their
                    own phone.
                </p>
            </main>
        </div>
    );
}
