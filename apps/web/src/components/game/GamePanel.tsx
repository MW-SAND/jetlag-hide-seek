import { useStore } from "@nanostores/react";
import { Inbox, Layers, MessageCircleQuestion, Plus } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { HiderTab } from "@/components/game/HiderTab";
import { QuestionList } from "@/components/game/QuestionList";
import { Button } from "@/components/ui/button";
import { ZonePanel } from "@/components/ZonePanel";
import {
    DESKTOP_QUERY,
    useMediaQuery,
    useViewportHeight,
} from "@/hooks/use-media-query";
import { currentPlayer, gameSession } from "@/lib/multiplayer";
import { unansweredQuestions } from "@/lib/question-store";
import {
    askOpen,
    openPanel,
    type PanelTab,
    panelTab,
    sheetHeight,
    type SheetSnap,
    sheetSnap,
} from "@/lib/ui-store";
import { cn } from "@/lib/utils";

/** Height of the collapsed sheet on phones (tabs + main action stay visible). */
export const SHEET_PEEK_PX = 148;
const TOP_BAR_PX = 76;

export function GamePanel() {
    const player = useStore(currentPlayer);
    const session = useStore(gameSession);
    const tab = useStore(panelTab);
    const snap = useStore(sheetSnap);
    const unanswered = useStore(unansweredQuestions);
    const desktop = useMediaQuery(DESKTOP_QUERY);
    const viewport = useViewportHeight();
    const isHider = player?.role === "hider";
    const playing = session?.phase === "playing";

    // Hiders land on their answer queue; seekers on their questions.
    useEffect(() => {
        if (!player) return;
        if (isHider) panelTab.set("answer");
        else if (panelTab.get() === "answer") panelTab.set("questions");
    }, [player?.id, isHider]);

    // Bring new questions to the hider's attention.
    const seen = useRef(0);
    useEffect(() => {
        if (isHider && unanswered.length > seen.current) {
            openPanel("answer");
            navigator.vibrate?.(80);
        }
        seen.current = unanswered.length;
    }, [isHider, unanswered.length]);

    const heights: Record<SheetSnap, number> = {
        peek: SHEET_PEEK_PX,
        half: Math.round(viewport * 0.55),
        full: viewport - TOP_BAR_PX,
    };

    // ─── Drag to resize (phones) ─────────────────────────────
    const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const onPointerDown = (e: PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, h: heights[snap], moved: false };
    };
    const onPointerMove = (e: PointerEvent) => {
        if (!drag.current) return;
        const dy = e.clientY - drag.current.y;
        if (Math.abs(dy) > 6) drag.current.moved = true;
        if (drag.current.moved) {
            setDragHeight(
                Math.min(
                    heights.full,
                    Math.max(heights.peek, drag.current.h - dy),
                ),
            );
        }
    };
    const onPointerUp = () => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        if (!state.moved) {
            sheetSnap.set(
                snap === "peek" ? "half" : snap === "half" ? "full" : "peek",
            );
        } else if (dragHeight !== null) {
            const nearest = (Object.keys(heights) as SheetSnap[]).reduce(
                (best, key) =>
                    Math.abs(heights[key] - dragHeight) <
                    Math.abs(heights[best] - dragHeight)
                        ? key
                        : best,
            );
            sheetSnap.set(nearest);
        }
        setDragHeight(null);
    };

    const tabs: {
        id: PanelTab;
        label: string;
        Icon: typeof Inbox;
        badge?: number;
    }[] = [
        ...(isHider
            ? [
                  {
                      id: "answer" as const,
                      label: "Answer",
                      Icon: Inbox,
                      badge: unanswered.length,
                  },
              ]
            : []),
        { id: "questions", label: "Questions", Icon: MessageCircleQuestion },
        { id: "zones", label: "Zones", Icon: Layers },
    ];

    const collapsed = !desktop && snap === "peek" && dragHeight === null;
    const showAsk = !isHider && playing && tab === "questions";

    const currentHeight = desktop ? 0 : (dragHeight ?? heights[snap]);
    useEffect(() => {
        sheetHeight.set(currentHeight);
        document.documentElement.style.setProperty(
            "--sheet-h",
            `${currentHeight}px`,
        );
    }, [currentHeight]);
    useEffect(
        () => () => {
            sheetHeight.set(0);
            document.documentElement.style.removeProperty("--sheet-h");
        },
        [],
    );

    return (
        <section
            aria-label="Game panel"
            data-testid="game-panel"
            data-snap={desktop ? "desktop" : snap}
            className={cn(
                "glass absolute z-[1100] flex flex-col overflow-hidden",
                desktop
                    ? "bottom-3 left-3 top-[76px] w-[400px] rounded-3xl"
                    : "inset-x-0 bottom-0 rounded-t-3xl",
                !desktop &&
                    dragHeight === null &&
                    "transition-[height] duration-300 ease-out",
            )}
            style={
                desktop ? undefined : { height: dragHeight ?? heights[snap] }
            }
        >
            {!desktop && (
                <div
                    role="button"
                    tabIndex={0}
                    aria-label={
                        snap === "peek" ? "Expand panel" : "Resize panel"
                    }
                    data-testid="sheet-handle"
                    className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            sheetSnap.set(snap === "peek" ? "half" : "peek");
                        }
                    }}
                >
                    <span className="h-1.5 w-12 rounded-full bg-white/25" />
                </div>
            )}

            <div
                role="tablist"
                aria-label="Panel sections"
                className={cn(
                    "mx-3 grid shrink-0 gap-1 rounded-2xl bg-white/5 p-1",
                    desktop && "mt-3",
                )}
                style={{
                    gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
                }}
            >
                {tabs.map(({ id, label, Icon, badge }) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        data-testid={`tab-${id}`}
                        onClick={() => openPanel(id)}
                        className={cn(
                            "relative flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors",
                            tab === id
                                ? "bg-white text-slate-900"
                                : "text-slate-300 hover:bg-white/5",
                        )}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                        {!!badge && (
                            <span
                                className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-900"
                                data-testid="answer-badge"
                            >
                                {badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div
                className={cn(
                    "scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3",
                    collapsed && "hidden",
                )}
                data-testid="panel-body"
            >
                {isHider && (
                    <div hidden={tab !== "answer"}>
                        <HiderTab />
                    </div>
                )}
                <div hidden={tab !== "questions"}>
                    <QuestionList />
                </div>
                <div hidden={tab !== "zones"}>
                    <ZonePanel />
                </div>
            </div>

            {showAsk && (
                <div className="safe-bottom shrink-0 border-t border-white/5 px-3 pb-3 pt-3">
                    <Button
                        size="lg"
                        className="w-full"
                        onClick={() => askOpen.set(true)}
                        data-testid="ask-question"
                    >
                        <Plus />
                        Ask a question
                    </Button>
                </div>
            )}
            {collapsed && !showAsk && isHider && (
                <p className="px-4 pt-3 text-center text-sm text-slate-300">
                    {unanswered.length > 0
                        ? `${unanswered.length} question${unanswered.length === 1 ? "" : "s"} waiting for your answer`
                        : "Waiting for questions from the seekers…"}
                </p>
            )}
        </section>
    );
}
