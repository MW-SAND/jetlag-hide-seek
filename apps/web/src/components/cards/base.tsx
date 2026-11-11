import { ICON_COLORS } from "@jetlag/geo/api/constants";
import { useStore } from "@nanostores/react";
import {
    Ban,
    Check,
    ChevronDown,
    Clock3,
    Copy,
    Loader2,
    Lock,
    Pencil,
    Send,
    Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import { QuestionKindIcon } from "@/components/game/QuestionKindIcon";
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
import { SidebarMenu } from "@/components/ui/sidebar-l";
import { questionModified, questions } from "@/lib/context";
import { currentPlayer, gameSession } from "@/lib/multiplayer";
import { commitQuestion, committedQuestions } from "@/lib/question-store";
import { focusQuestionKey } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

type Status =
    | { kind: "editing" }
    | { kind: "locked" }
    | { kind: "sent" }
    | { kind: "answered"; label: string }
    | { kind: "vetoed"; reason: string | null };

/** What the hider answered, in words (from the answer-applied question data). */
function answeredLabel(type: string | undefined, d: any): string {
    switch (type) {
        case "radius":
            return d.within ? "Inside" : "Outside";
        case "thermometer":
            return d.warmer ? "Warmer" : "Colder";
        case "matching":
            return d.same ? "Same" : "Different";
        case "measuring":
            return d.hiderCloser ? "Closer" : "Further";
        case "tentacles":
            return d.location
                ? String(d.location?.properties?.name ?? "A place")
                : "Not in range";
        default:
            return "Answered";
    }
}

function StatusChip({ status }: { status: Status }) {
    const base =
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";
    switch (status.kind) {
        case "editing":
            return (
                <span className={cn(base, "bg-white/10 text-slate-300")}>
                    <Pencil className="h-3 w-3" /> Editing
                </span>
            );
        case "locked":
            return (
                <span className={cn(base, "bg-white/10 text-slate-300")}>
                    <Lock className="h-3 w-3" /> Locked
                </span>
            );
        case "sent":
            return (
                <span className={cn(base, "bg-amber-500/15 text-amber-300")}>
                    <Clock3 className="h-3 w-3" /> Waiting
                </span>
            );
        case "answered":
            return (
                <span
                    className={cn(
                        base,
                        "max-w-[9rem] bg-emerald-500/15 text-emerald-300",
                    )}
                    data-testid="answer-chip"
                >
                    <Check className="h-3 w-3 shrink-0" />
                    <span className="truncate">{status.label}</span>
                </span>
            );
        case "vetoed":
            return (
                <span
                    className={cn(base, "bg-red-500/15 text-red-300")}
                    title={status.reason ?? undefined}
                >
                    <Ban className="h-3 w-3" /> Vetoed
                </span>
            );
    }
}

/** Only shown outside a multiplayer game (in a game the hider gives the answer). */
export function SoloOnly({ children }: { children: React.ReactNode }) {
    const session = useStore(gameSession);
    return session ? null : <>{children}</>;
}

export const QuestionCard = ({
    children,
    questionKey,
    className,
    label,
    sub,
    collapsed,
    locked,
    setLocked,
    setCollapsed,
}: {
    children: React.ReactNode;
    questionKey: number;
    className?: string;
    label?: string;
    sub?: string;
    collapsed?: boolean;
    locked?: boolean;
    setLocked?: (locked: boolean) => void;
    setCollapsed?: (collapsed: boolean) => void;
}) => {
    const [isCollapsed, setIsCollapsed] = useState(collapsed ?? false);
    const [sending, setSending] = useState(false);
    const $questions = useStore(questions);
    const $session = useStore(gameSession);
    const $player = useStore(currentPlayer);
    const $committed = useStore(committedQuestions);
    const $focus = useStore(focusQuestionKey);
    const ref = useRef<HTMLElement>(null);

    const question = $questions.find((q) => q.key === questionKey);
    const data = (question?.data ?? {}) as any;
    const dbId: string | undefined = data._dbId;
    const committed = dbId
        ? $committed.find((cq) => cq.dbId === dbId)
        : undefined;
    const inGame = $session?.phase === "playing";
    const isSeeker = $player?.role === "seeker";
    const canEdit = !dbId && (!$session || (inGame && isSeeker));

    const status: Status = committed?.veto
        ? { kind: "vetoed", reason: committed.veto.reason }
        : committed?.answer
          ? { kind: "answered", label: answeredLabel(question?.id, data) }
          : dbId
            ? { kind: "sent" }
            : locked === false
              ? { kind: "editing" }
              : { kind: "locked" };

    // Scroll to and open a card that was just added.
    useEffect(() => {
        if ($focus !== questionKey) return;
        setIsCollapsed(false);
        setCollapsed?.(false);
        requestAnimationFrame(() =>
            ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
        focusQuestionKey.set(null);
    }, [$focus, questionKey]);

    const toggleCollapse = () => {
        setCollapsed?.(!isCollapsed);
        setIsCollapsed((v) => !v);
    };

    const copyJson = async () => {
        try {
            await navigator.clipboard.writeText(
                JSON.stringify(question, null, 2),
            );
            toast.success("Question copied", { autoClose: 1500 });
        } catch {
            toast.error("Clipboard not available");
        }
    };

    const send = async () => {
        if (!question) return;
        setSending(true);
        try {
            // Sending locks the question (the server only accepts locked ones).
            if (data.drag) questionModified((data.drag = false));
            await commitQuestion(question);
            toast.success("Sent to the hiders", { autoClose: 1500 });
        } catch (err: any) {
            toast.error(err?.message || "Failed to send");
        } finally {
            setSending(false);
        }
    };

    const color = data.color
        ? ICON_COLORS[data.color as keyof typeof ICON_COLORS]
        : undefined;

    return (
        <article
            ref={ref}
            data-testid="question-card"
            data-question-key={questionKey}
            data-question-type={question?.id}
            data-status={status.kind}
            className={cn(
                "scroll-mt-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]",
                className,
            )}
        >
            <button
                type="button"
                onClick={toggleCollapse}
                aria-expanded={!isCollapsed}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03]"
            >
                <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10"
                    style={
                        color
                            ? { boxShadow: `inset 0 0 0 2px ${color}` }
                            : undefined
                    }
                >
                    <QuestionKindIcon
                        kind={question?.id}
                        className="h-4 w-4 text-white"
                    />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                        {label?.replace(/\s+/g, " ").trim()}
                    </span>
                    {sub && (
                        <span className="block truncate text-xs text-slate-400">
                            {sub}
                        </span>
                    )}
                </span>
                <StatusChip status={status} />
                <ChevronDown
                    className={cn(
                        "h-4 w-4 shrink-0 text-slate-400 transition-transform",
                        isCollapsed && "-rotate-90",
                    )}
                />
            </button>

            {!isCollapsed && (
                <div className="border-t border-white/5 px-1 pb-3">
                    <SidebarMenu className="pt-1">{children}</SidebarMenu>

                    <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
                        {canEdit && locked !== undefined && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setLocked!(!locked)}
                                data-testid="toggle-lock"
                            >
                                {locked ? <Pencil /> : <Lock />}
                                {locked ? "Edit" : "Lock"}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={copyJson}
                            aria-label="Copy question"
                        >
                            <Copy />
                            Copy
                        </Button>
                        {!dbId && (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="ml-auto text-red-300 hover:text-red-200"
                                        data-testid="delete-question"
                                    >
                                        <Trash2 />
                                        Delete
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            Delete this question?
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            It disappears from your map. This
                                            can&apos;t be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>
                                            Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            data-testid="confirm-delete"
                                            onClick={() =>
                                                questions.set(
                                                    $questions.filter(
                                                        (q) =>
                                                            q.key !==
                                                            questionKey,
                                                    ),
                                                )
                                            }
                                        >
                                            Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                    </div>

                    {inGame && isSeeker && !dbId && (
                        <div className="px-2 pt-3">
                            <Button
                                className="w-full"
                                onClick={send}
                                disabled={sending}
                                data-testid="send-question"
                            >
                                {sending ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <Send />
                                )}
                                {sending ? "Sending…" : "Send to hider"}
                            </Button>
                        </div>
                    )}
                    {committed?.veto?.reason && (
                        <p className="mx-2 mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200">
                            Veto reason: {committed.veto.reason}
                        </p>
                    )}
                </div>
            )}
        </article>
    );
};
