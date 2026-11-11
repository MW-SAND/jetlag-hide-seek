/**
 * Hider answer UI — questions waiting for an answer plus the undo window.
 * Only rendered for players with role === "hider".
 */
import { findTentacleLocations } from "@jetlag/geo/api";
import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import {
    Ban,
    Clock,
    Inbox,
    Loader2,
    Send,
    Sparkles,
    Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { QuestionKindIcon } from "@/components/game/QuestionKindIcon";
import { Button } from "@/components/ui/button";
import { RawInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
    answerDraftSelections,
    answerQuestion,
    clearDraftAnswerSelection,
    type CommittedQuestion,
    committedQuestions,
    deriveSuggestedConfirmed,
    deriveSuggestedTentacleSelection,
    deriveTentacleConfirmed,
    type DraftAnswerSelection,
    setDraftAnswerSelection,
    unansweredQuestions,
    undoAnswer,
    vetoQuestion,
} from "@/lib/question-store";
import { cn, mapToObj } from "@/lib/utils";

export function HiderAnswerPanel() {
    const unanswered = useStore(unansweredQuestions);
    const allQuestions = useStore(committedQuestions);
    const [, setTick] = useState(0);

    const recentlyAnswered = allQuestions.filter(
        (q) =>
            q.answer && new Date(q.answer.undoDeadline).getTime() > Date.now(),
    );

    // Re-render once the last undo window closes so the card disappears.
    useEffect(() => {
        if (recentlyAnswered.length === 0) return;
        const interval = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(interval);
    }, [recentlyAnswered.length]);

    return (
        <div className="space-y-4" data-testid="hider-answers">
            {unanswered.length > 0 && (
                <section className="space-y-2.5">
                    <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Waiting for your answer · {unanswered.length}
                    </h3>
                    {unanswered.map((q) =>
                        q.questionType === "tentacles" ? (
                            <TentacleCard key={q.dbId} question={q} />
                        ) : (
                            <StandardCard key={q.dbId} question={q} />
                        ),
                    )}
                </section>
            )}

            {recentlyAnswered.length > 0 && (
                <section className="space-y-2.5">
                    <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-amber-300/80">
                        Just answered
                    </h3>
                    {recentlyAnswered.map((q) => (
                        <UndoCard key={q.dbId} question={q} />
                    ))}
                </section>
            )}

            {unanswered.length === 0 && recentlyAnswered.length === 0 && (
                <div
                    className="flex flex-col items-center gap-2 px-6 py-8 text-center"
                    data-testid="no-questions"
                >
                    <Inbox className="h-8 w-8 text-slate-600" />
                    <p className="text-sm font-medium text-slate-300">
                        No questions yet
                    </p>
                    <p className="text-xs text-slate-500">
                        When the seekers ask something, it shows up here and
                        your phone buzzes.
                    </p>
                </div>
            )}
        </div>
    );
}

function CardShell({
    question,
    children,
}: {
    question: CommittedQuestion;
    children: React.ReactNode;
}) {
    const sentAt = new Date(question.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
    return (
        <article
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5"
            data-testid="answer-card"
            data-question-type={question.questionType}
            data-question-order={question.order}
        >
            <div className="mb-3 flex items-start gap-3">
                <QuestionKindIcon kind={question.questionType as any} />
                <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-slate-500">
                        Q{question.order} · {question.questionType} · {sentAt}
                    </p>
                    <p
                        className="text-[15px] font-medium leading-snug text-white"
                        data-testid="answer-prompt"
                    >
                        {questionPrompt(question)}
                    </p>
                </div>
            </div>
            {children}
        </article>
    );
}

function StandardCard({ question }: { question: CommittedQuestion }) {
    const [sending, setSending] = useState(false);
    const [selected, setSelected] = useState<boolean | null>(null);
    const [initializing, setInitializing] = useState(true);
    const [suggested, setSuggested] = useState<boolean | null>(null);
    const drafts = useStore(answerDraftSelections);
    const touched = useRef(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            let suggestion: boolean | null = null;
            try {
                suggestion = await deriveSuggestedConfirmed(question);
            } catch {
                // The hider simply picks manually.
            }
            if (cancelled) return;
            setSuggested(suggestion);
            setInitializing(false);
            // Never override a choice the hider already made.
            if (touched.current) return;
            const existing = drafts[question.dbId];
            const initial =
                existing && typeof existing.confirmed === "boolean"
                    ? existing.confirmed
                    : suggestion;
            setSelected(initial);
            if (initial !== null)
                setDraftAnswerSelection(question, { confirmed: initial });
        })();
        return () => {
            cancelled = true;
        };
    }, [question.dbId]);

    const choose = (confirmed: boolean) => {
        touched.current = true;
        setSelected(confirmed);
        setDraftAnswerSelection(question, { confirmed });
    };

    const send = async () => {
        if (selected === null) return;
        setSending(true);
        try {
            await answerQuestion(question.dbId, { confirmed: selected });
            clearDraftAnswerSelection(question.dbId);
        } catch (err) {
            console.error("Failed to answer:", err);
        } finally {
            setSending(false);
        }
    };

    const options = getAnswerOptions(question);
    const canSend = !sending && selected !== null;

    return (
        <CardShell question={question}>
            <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Your answer"
            >
                {[options.first, options.second].map((option) => {
                    const active = selected === option.confirmed;
                    return (
                        <button
                            key={option.label}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={sending}
                            onClick={() => choose(option.confirmed)}
                            data-testid="answer-option"
                            className={cn(
                                "relative flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
                                active
                                    ? "border-emerald-400 bg-emerald-500/20 text-white"
                                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
                            )}
                        >
                            {option.label}
                            {suggested === option.confirmed && (
                                <span className="mt-0.5 flex items-center gap-1 text-[10px] font-normal text-emerald-300/90">
                                    <Sparkles className="h-3 w-3" />
                                    from your spot
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <Button
                variant="hider"
                className="mt-2.5 w-full"
                onClick={send}
                disabled={!canSend}
                data-testid="send-answer"
            >
                {sending || (initializing && selected === null) ? (
                    <Loader2 className="animate-spin" />
                ) : (
                    <Send />
                )}
                {initializing && selected === null
                    ? "Checking your spot…"
                    : "Send answer"}
            </Button>
            <VetoControl question={question} disabled={sending} />
        </CardShell>
    );
}

function TentacleCard({ question }: { question: CommittedQuestion }) {
    const [sending, setSending] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [options, setOptions] = useState<any[]>([]);
    const [selectedName, setSelectedName] = useState<string>("false");
    const drafts = useStore(answerDraftSelections);
    const qData = question.questionData as any;

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            const allFeatures =
                qData.locationType === "custom"
                    ? (qData.places ?? [])
                    : (await findTentacleLocations(qData)).features;

            const inRange =
                qData.lat === null || qData.lng === null || qData.radius == null
                    ? allFeatures
                    : allFeatures.filter((feature: any) => {
                          const coords =
                              feature?.geometry?.coordinates ??
                              (feature?.properties?.lon &&
                              feature?.properties?.lat
                                  ? [
                                        feature.properties.lon,
                                        feature.properties.lat,
                                    ]
                                  : null);
                          if (!coords) return false;
                          return (
                              turf.distance(
                                  turf.point([qData.lng, qData.lat]),
                                  turf.point(coords),
                                  {
                                      units: qData.unit,
                                  },
                              ) <= qData.radius
                          );
                      });

            if (cancelled) return;
            setOptions(inRange);

            const existing = drafts[question.dbId];
            if (existing?.selectedTentacleName) {
                setSelectedName(existing.selectedTentacleName);
                setInitializing(false);
                return;
            }

            const suggested = await deriveSuggestedTentacleSelection(question);
            if (cancelled) return;
            const names = new Set(
                inRange.map((f: any) => String(f?.properties?.name ?? "")),
            );
            const name =
                suggested.selectedTentacleName === "false" ||
                names.has(suggested.selectedTentacleName)
                    ? suggested.selectedTentacleName
                    : "false";
            select(name, inRange);
            setInitializing(false);
        };

        load().catch(() => {
            if (cancelled) return;
            setOptions([]);
            select("false", []);
            setInitializing(false);
        });

        return () => {
            cancelled = true;
        };
    }, [question.dbId]);

    function select(value: string, pool = options) {
        const location =
            value === "false"
                ? false
                : (pool.find(
                      (f: any) => String(f?.properties?.name ?? "") === value,
                  ) ?? false);
        setSelectedName(value);
        setDraftAnswerSelection(question, {
            confirmed: deriveTentacleConfirmed(qData.location, location),
            selectedTentacleName: value,
            selectedTentacleLocation: location,
        });
    }

    const send = async () => {
        const draft = drafts[question.dbId];
        const answer: DraftAnswerSelection =
            draft && typeof draft.confirmed === "boolean"
                ? draft
                : {
                      confirmed: deriveTentacleConfirmed(qData.location, false),
                      selectedTentacleName: "false",
                      selectedTentacleLocation: false,
                  };
        setSending(true);
        try {
            await answerQuestion(question.dbId, answer);
            clearDraftAnswerSelection(question.dbId);
        } catch (err) {
            console.error("Failed to answer:", err);
        } finally {
            setSending(false);
        }
    };

    const busy = sending || initializing;

    return (
        <CardShell question={question}>
            <div data-testid="tentacle-select">
                <Select
                    trigger="Closest place"
                    options={{
                        false: "I'm not within range",
                        ...mapToObj(options, (feature: any) => [
                            String(feature?.properties?.name ?? "Unknown"),
                            String(feature?.properties?.name ?? "Unknown"),
                        ]),
                    }}
                    value={selectedName as any}
                    onValueChange={(v: any) => select(v)}
                    disabled={busy}
                />
            </div>
            <Button
                variant="hider"
                className="mt-2.5 w-full"
                onClick={send}
                disabled={busy}
                data-testid="send-answer"
            >
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
                {initializing ? "Finding places…" : "Send answer"}
            </Button>
            <VetoControl question={question} disabled={sending} />
        </CardShell>
    );
}

function UndoCard({ question }: { question: CommittedQuestion }) {
    const [undoing, setUndoing] = useState(false);
    if (!question.answer) return null;
    const seconds = Math.max(
        0,
        Math.ceil(
            (new Date(question.answer.undoDeadline).getTime() - Date.now()) /
                1000,
        ),
    );
    if (seconds <= 0) return null;

    const undo = async () => {
        if (!question.answer) return;
        setUndoing(true);
        try {
            await undoAnswer(question.answer.dbId);
        } catch (err) {
            console.error("Failed to undo:", err);
        } finally {
            setUndoing(false);
        }
    };

    return (
        <div
            className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3"
            data-testid="undo-card"
            data-question-type={question.questionType}
            data-question-order={question.order}
        >
            <QuestionKindIcon kind={question.questionType as any} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">
                    {questionPrompt(question)}
                </p>
                <p className="text-xs text-slate-400">
                    You answered:{" "}
                    <span className="font-semibold text-white">
                        {answerLabel(question)}
                    </span>
                </p>
            </div>
            <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={undoing}
                data-testid="undo-answer"
            >
                <Undo2 />
                Undo
                <span className="flex items-center gap-0.5 text-[11px] font-normal tabular-nums text-slate-400">
                    <Clock className="h-3 w-3" />
                    {seconds}s
                </span>
            </Button>
        </div>
    );
}

function VetoControl({
    question,
    disabled,
}: {
    question: CommittedQuestion;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [vetoing, setVetoing] = useState(false);

    const veto = async () => {
        setVetoing(true);
        try {
            await vetoQuestion(question.dbId, reason.trim() || null);
        } catch (err) {
            console.error("Failed to veto:", err);
            setVetoing(false);
        }
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={disabled}
                className="mt-1.5 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-red-300 disabled:opacity-50"
                data-testid="veto-question"
            >
                <Ban className="h-3.5 w-3.5" />
                Veto this question
            </button>
        );
    }
    return (
        <div className="mt-2.5 space-y-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-2.5">
            <RawInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                maxLength={200}
                data-testid="veto-reason"
            />
            <div className="grid grid-cols-2 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={vetoing}
                >
                    Cancel
                </Button>
                <Button
                    variant="destructive"
                    size="sm"
                    onClick={veto}
                    disabled={vetoing}
                    data-testid="confirm-veto"
                >
                    {vetoing ? <Loader2 className="animate-spin" /> : <Ban />}
                    Veto
                </Button>
            </div>
        </div>
    );
}

// ─── Wording ─────────────────────────────────────────────────

const UNIT_LABEL: Record<string, [string, string]> = {
    miles: ["mile", "miles"],
    kilometers: ["km", "km"],
    meters: ["m", "m"],
};

function distance(value: unknown, unit: unknown): string {
    const n = Number(value);
    const [one, many] = UNIT_LABEL[String(unit)] ?? [
        String(unit),
        String(unit),
    ];
    return `${n} ${n === 1 ? one : many}`;
}

/** "major-city-full" → "major city". */
function thing(type: unknown): string {
    return String(type ?? "place")
        .replace(/-full$/, "")
        .replace(/^custom-.*/, "custom place")
        .replace(/[-_]/g, " ");
}

export function questionPrompt(q: CommittedQuestion): string {
    const d = q.questionData as Record<string, unknown>;
    switch (q.questionType) {
        case "radius":
            return `Are you within ${distance(d.radius, d.unit)} of the seekers?`;
        case "thermometer":
            return "The seekers moved. Are they now warmer or colder?";
        case "tentacles":
            return `Of the ${thing(d.locationType)}s within ${distance(d.radius, d.unit)} of the seekers, which is closest to you?`;
        case "matching":
            return `Is your nearest ${thing(d.type)} the same as the seekers'?`;
        case "measuring":
            return `Compared to the seekers, are you closer to or further from a ${thing(d.type)}?`;
        default:
            return `${q.questionType} question`;
    }
}

function answerLabel(q: CommittedQuestion): string {
    const data = q.answer?.answerData as Record<string, unknown> | undefined;
    if (!data) return "";
    if (q.questionType === "tentacles") {
        const name = data.selectedTentacleName;
        return !name || name === "false" ? "Not in range" : String(name);
    }
    const options = getAnswerOptions(q);
    const confirmed = !!data.confirmed;
    return options.first.confirmed === confirmed
        ? options.first.label
        : options.second.label;
}

function getAnswerOptions(question: CommittedQuestion): {
    first: { label: string; confirmed: boolean };
    second: { label: string; confirmed: boolean };
} {
    const d = question.questionData as Record<string, unknown>;
    // `confirmed` means "the seeker's drawn proposition is true".
    const pair = (no: string, yes: string, proposition: boolean) => ({
        first: { label: no, confirmed: proposition === false },
        second: { label: yes, confirmed: proposition === true },
    });
    switch (question.questionType) {
        case "radius":
            return pair("No, outside", "Yes, inside", !!d.within);
        case "thermometer":
            return pair("Colder", "Warmer", !!d.warmer);
        case "measuring":
            return pair("Further", "Closer", !!d.hiderCloser);
        case "matching":
            return pair("Different", "Same", !!d.same);
        default:
            return {
                first: { label: "Yes", confirmed: true },
                second: { label: "No", confirmed: false },
            };
    }
}
