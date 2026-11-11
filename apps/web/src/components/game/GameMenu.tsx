import { useStore } from "@nanostores/react";
import {
    ClipboardCopy,
    ClipboardPaste,
    Flag,
    Layers2,
    LogOut,
    Share2,
    Trash2,
    UserPlus,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "react-toastify";

import { PlacePicker } from "@/components/PlacePicker";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import { RawInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UnitSelect } from "@/components/UnitSelect";
import {
    allowGooglePlusCodes,
    alwaysUseShortLinks,
    animateMapMovements,
    autoSave,
    autoZoom,
    customInitPreference,
    defaultCustomQuestions,
    defaultUnit,
    followMe,
    hidingZone,
    leafletMapContext,
    mapGeoLocation,
    permanentOverlay,
    planningModeEnabled,
    polyGeoJSON,
    questions,
    thunderforestApiKey,
} from "@/lib/context";
import {
    currentPlayer,
    endGame,
    gameSession,
    isHost,
    leaveGame,
} from "@/lib/multiplayer";
import { inviteLink } from "@/lib/preferences";
import { loadHidingZone, shareMapSetup } from "@/lib/share";
import { menuOpen } from "@/lib/ui-store";

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-1">
            <h3 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {title}
            </h3>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                {children}
            </div>
        </section>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-h-12 items-center gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 text-sm font-medium text-white">
                {label}
            </span>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

async function readClipboard(): Promise<string | null> {
    try {
        return await navigator.clipboard.readText();
    } catch {
        toast.error("Clipboard not available (needs https).");
        return null;
    }
}

export function GameMenu() {
    const open = useStore(menuOpen);
    const session = useStore(gameSession);
    const amHost = useStore(isHost);
    const me = useStore(currentPlayer);
    const location = useStore(mapGeoLocation);
    const poly = useStore(polyGeoJSON);
    const $autoZoom = useStore(autoZoom);
    const $animate = useStore(animateMapMovements);
    const $followMe = useStore(followMe);
    const $planning = useStore(planningModeEnabled);
    const $autoSave = useStore(autoSave);
    const $unit = useStore(defaultUnit);
    const $customDefault = useStore(defaultCustomQuestions);
    const $customInit = useStore(customInitPreference);
    const $plusCodes = useStore(allowGooglePlusCodes);
    const $shortLinks = useStore(alwaysUseShortLinks);
    const $tfKey = useStore(thunderforestApiKey);
    const $overlay = useStore(permanentOverlay);
    const [ending, setEnding] = useState(false);

    if (!session) return null;
    const isSeeker = me?.role === "seeker";
    const playing = session.phase === "playing";
    const close = () => menuOpen.set(false);

    const togglePlanning = (enabled: boolean) => {
        if (!enabled) {
            // Remove the planning outlines drawn for unlocked questions.
            const map = leafletMapContext.get();
            map?.eachLayer((layer: any) => {
                if (layer.questionKey || layer.questionKey === 0)
                    map.removeLayer(layer);
            });
        } else {
            questions.set([...questions.get()]);
        }
        planningModeEnabled.set(enabled);
    };

    return (
        <Drawer open={open} onOpenChange={menuOpen.set}>
            <DrawerContent data-testid="game-menu">
                <div className="safe-bottom mx-auto w-full max-w-lg space-y-3 px-4 pb-6">
                    <DrawerHeader className="px-1 pb-0 text-left">
                        <DrawerTitle className="text-xl text-white">
                            Menu
                        </DrawerTitle>
                        <DrawerDescription className="text-slate-400">
                            Room{" "}
                            <span className="font-mono tracking-wider text-slate-200">
                                {session.roomCode}
                            </span>
                            {" · "}
                            {me?.role === "hider"
                                ? "You're hiding"
                                : "You're seeking"}
                            {amHost && " · Host"}
                        </DrawerDescription>
                    </DrawerHeader>

                    <Section title="Game">
                        <button
                            type="button"
                            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-white/5"
                            data-testid="menu-invite"
                            onClick={async () => {
                                const link = inviteLink(session.roomCode);
                                if (typeof navigator.share === "function") {
                                    try {
                                        await navigator.share({
                                            title: "Join my Hide & Seek game",
                                            text: `Room code ${session.roomCode}`,
                                            url: link,
                                        });
                                    } catch {
                                        /* dismissed */
                                    }
                                    return;
                                }
                                try {
                                    await navigator.clipboard.writeText(link);
                                    toast.success("Invite link copied", {
                                        autoClose: 1500,
                                    });
                                } catch {
                                    window.prompt(
                                        "Copy this invite link:",
                                        link,
                                    );
                                }
                            }}
                        >
                            <UserPlus className="h-4 w-4 text-blue-300" />{" "}
                            Invite players
                            <span className="ml-auto font-mono text-xs tracking-wider text-slate-400">
                                {session.roomCode}
                            </span>
                        </button>
                        {amHost && playing && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-amber-200 hover:bg-white/5"
                                        data-testid="end-game"
                                    >
                                        <Flag className="h-4 w-4" /> End the
                                        game for everyone
                                    </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            End the game?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Everyone sees the final results.
                                            Questions can no longer be asked.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>
                                            Keep playing
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            data-testid="confirm-end-game"
                                            disabled={ending}
                                            onClick={async () => {
                                                setEnding(true);
                                                await endGame();
                                                setEnding(false);
                                                close();
                                            }}
                                        >
                                            End game
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <button
                                    type="button"
                                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-red-300 hover:bg-white/5"
                                    data-testid="leave-game"
                                >
                                    <LogOut className="h-4 w-4" /> Leave game
                                </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>
                                        Leave this game?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {playing
                                            ? "Games in progress can't be rejoined after leaving."
                                            : `You can join again with room code ${session.roomCode}.`}
                                        {amHost
                                            ? " Someone else becomes host."
                                            : ""}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Stay</AlertDialogCancel>
                                    <AlertDialogAction
                                        data-testid="confirm-leave"
                                        onClick={() => {
                                            close();
                                            void leaveGame();
                                        }}
                                    >
                                        Leave
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </Section>

                    <Section title="Play area">
                        <div className="p-2">
                            {amHost ? (
                                <PlacePicker />
                            ) : (
                                <p className="px-1 py-2 text-sm text-slate-300">
                                    {poly
                                        ? "Custom drawn area"
                                        : (location?.properties?.name ??
                                          "Not set")}
                                    <span className="block text-xs text-slate-500">
                                        Only the host can change it.
                                    </span>
                                </p>
                            )}
                        </div>
                    </Section>

                    <Section title="Map">
                        <Switch
                            label="Zoom to results"
                            description="Fit the map to the remaining area"
                            checked={$autoZoom}
                            onCheckedChange={autoZoom.set}
                        />
                        <Switch
                            label="Animate map"
                            checked={$animate}
                            onCheckedChange={animateMapMovements.set}
                        />
                        <Switch
                            label="Show my location"
                            description="Live GPS dot on the map"
                            checked={$followMe}
                            onCheckedChange={followMe.set}
                            testId="toggle-follow-me"
                        />
                        {isSeeker && (
                            <Switch
                                label="Planning mode"
                                description="Preview what each unlocked question would cut"
                                checked={$planning}
                                onCheckedChange={togglePlanning}
                                testId="toggle-planning"
                            />
                        )}
                        <div className="px-3 py-2">
                            <label
                                className="mb-1 block text-sm font-medium text-white"
                                htmlFor="tf-key"
                            >
                                Thunderforest key{" "}
                                <span className="font-normal text-slate-400">
                                    (optional, for transit maps)
                                </span>
                            </label>
                            <RawInput
                                id="tf-key"
                                value={$tfKey}
                                onChange={(e) =>
                                    thunderforestApiKey.set(
                                        e.target.value.trim(),
                                    )
                                }
                                placeholder="Paste a free API key"
                                autoComplete="off"
                            />
                        </div>
                    </Section>

                    {isSeeker && (
                        <Section title="Questions">
                            <Row label="Default unit">
                                <UnitSelect
                                    unit={$unit}
                                    onChange={defaultUnit.set}
                                />
                            </Row>
                            <Switch
                                label="Custom questions by default"
                                description="Start new questions with your own places"
                                checked={$customDefault}
                                onCheckedChange={defaultCustomQuestions.set}
                            />
                            <Row label="New custom question">
                                <Select
                                    trigger="Choose"
                                    options={{
                                        ask: "Ask each time",
                                        blank: "Start blank",
                                        prefill: "Copy current",
                                    }}
                                    value={$customInit}
                                    onValueChange={(v) =>
                                        customInitPreference.set(v as any)
                                    }
                                />
                            </Row>
                            <Switch
                                label="Allow Google Plus Codes"
                                checked={$plusCodes}
                                onCheckedChange={allowGooglePlusCodes.set}
                            />
                            <Switch
                                label="Apply changes instantly"
                                description="Off: edits apply when you press Save"
                                checked={$autoSave}
                                onCheckedChange={autoSave.set}
                            />
                        </Section>
                    )}

                    <Section title="Share & data">
                        <button
                            type="button"
                            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-white/5"
                            onClick={() => void shareMapSetup()}
                            data-testid="share-map"
                        >
                            <Share2 className="h-4 w-4 text-blue-300" /> Share
                            this map as a link
                        </button>
                        <Switch
                            label="Always use short links"
                            checked={$shortLinks}
                            onCheckedChange={alwaysUseShortLinks.set}
                        />
                        <button
                            type="button"
                            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-white/5"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(
                                        JSON.stringify(hidingZone.get()),
                                    );
                                    toast.success("Map setup copied", {
                                        autoClose: 1500,
                                    });
                                } catch {
                                    toast.error(
                                        "Clipboard not available (needs https).",
                                    );
                                }
                            }}
                        >
                            <ClipboardCopy className="h-4 w-4 text-slate-300" />{" "}
                            Copy map setup (JSON)
                        </button>
                        {(amHost || !session) && (
                            <button
                                type="button"
                                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-white/5"
                                onClick={async () => {
                                    const text = await readClipboard();
                                    if (text) loadHidingZone(text);
                                }}
                            >
                                <ClipboardPaste className="h-4 w-4 text-slate-300" />{" "}
                                Paste map setup
                            </button>
                        )}
                        <button
                            type="button"
                            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-white/5"
                            onClick={async () => {
                                const text = await readClipboard();
                                if (!text) return;
                                try {
                                    permanentOverlay.set(JSON.parse(text));
                                    toast.success("Overlay added", {
                                        autoClose: 1500,
                                    });
                                } catch (e) {
                                    toast.error(
                                        `Invalid GeoJSON overlay: ${e}`,
                                    );
                                }
                            }}
                        >
                            <Layers2 className="h-4 w-4 text-slate-300" /> Paste
                            GeoJSON overlay
                        </button>
                        {$overlay && (
                            <button
                                type="button"
                                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-red-300 hover:bg-white/5"
                                onClick={() => permanentOverlay.set(null)}
                            >
                                <Trash2 className="h-4 w-4" /> Remove overlay
                            </button>
                        )}
                    </Section>

                    <Button
                        variant="outline"
                        className="w-full"
                        onClick={close}
                    >
                        Done
                    </Button>
                    <p className="text-center text-[11px] text-slate-500">
                        Based on the open-source map generator by taibeled · Map
                        data © OpenStreetMap contributors
                    </p>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
