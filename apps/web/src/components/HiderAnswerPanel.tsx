/**
 * Hider answer UI — shows unanswered questions with answer controls.
 * Only rendered for players with role === "hider".
 */
import { findTentacleLocations } from "@jetlag/geo/api";
import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import { Ban, Check, Clock, Loader2, Send, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { mapToObj } from "@/lib/utils";

export function HiderAnswerPanel() {
    const unanswered = useStore(unansweredQuestions);
    const allQuestions = useStore(committedQuestions);

    // Recently answered questions (for undo window)
    const recentlyAnswered = allQuestions.filter((q) => {
        if (!q.answer) return false;
        const deadline = new Date(q.answer.undoDeadline).getTime();
        return deadline > Date.now();
    });

    return (
        <div className="space-y-3">
            {/* Unanswered questions */}
            {unanswered.length > 0 && (
                <div>
                    <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2 px-1">
                        Awaiting Your Answer ({unanswered.length})
                    </h3>
                    {unanswered.map((q) => (
                        <UnansweredCard key={q.dbId} question={q} />
                    ))}
                </div>
            )}

            {/* Undo window */}
            {recentlyAnswered.length > 0 && (
                <div>
                    <h3 className="text-xs uppercase tracking-wider text-amber-400/70 mb-2 px-1">
                        Recently Answered (undo available)
                    </h3>
                    {recentlyAnswered.map((q) => (
                        <UndoableCard key={q.dbId} question={q} />
                    ))}
                </div>
            )}

            {unanswered.length === 0 && recentlyAnswered.length === 0 && (
                <div className="text-center text-slate-500 text-sm py-4">
                    No questions to answer yet
                </div>
            )}
        </div>
    );
}

function UnansweredCard({ question }: { question: CommittedQuestion }) {
    if (question.questionType === "tentacles") {
        return <TentacleUnansweredCard question={question} />;
    }
    return <StandardUnansweredCard question={question} />;
}

function StandardUnansweredCard({ question }: { question: CommittedQuestion }) {
    const [answering, setAnswering] = useState(false);
    const [selected, setSelected] = useState<boolean | null>(null);
    const [initializing, setInitializing] = useState(true);
    const drafts = useStore(answerDraftSelections);

    const label = formatQuestionLabel(question);

    useEffect(() => {
        let cancelled = false;

        const initSelection = async () => {
            const existingDraft = drafts[question.dbId];
            if (existingDraft && typeof existingDraft.confirmed === "boolean") {
                setSelected(existingDraft.confirmed);
                setInitializing(false);
                return;
            }

            try {
                const suggested = await deriveSuggestedConfirmed(question);
                if (cancelled) return;
                setSelected(suggested);
                setDraftAnswerSelection(question, { confirmed: suggested });
            } catch {
                if (cancelled) return;
                // Safe fallback: keep original seeker proposition as default.
                setSelected(true);
                setDraftAnswerSelection(question, { confirmed: true });
            } finally {
                if (!cancelled) {
                    setInitializing(false);
                }
            }
        };

        initSelection();

        return () => {
            cancelled = true;
        };
    }, [question.dbId]);

    const setChoice = (confirmed: boolean) => {
        setSelected(confirmed);
        setDraftAnswerSelection(question, { confirmed });
    };

    const handleSend = async () => {
        if (selected === null) return;
        setAnswering(true);
        try {
            await answerQuestion(question.dbId, { confirmed: selected });
            clearDraftAnswerSelection(question.dbId);
        } catch (err: any) {
            console.error("Failed to answer:", err);
        } finally {
            setAnswering(false);
        }
    };

    const sentAt = new Date(question.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
    const options = getAnswerOptions(question);

    return (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-2">
            <div className="text-sm text-slate-300 mb-1">
                <span className="text-slate-500 text-xs">
                    Q{question.order}
                </span>{" "}
                {label}
            </div>
            <div className="text-xs text-slate-500 mb-2">Sent at {sentAt}</div>
            <div className="flex gap-2 mb-2">
                <Button
                    size="sm"
                    variant={
                        selected === options.first.confirmed
                            ? "default"
                            : "outline"
                    }
                    onClick={() => setChoice(options.first.confirmed)}
                    disabled={answering || initializing}
                    className={`flex-1 gap-1 ${
                        selected === options.first.confirmed
                            ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                            : "text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10"
                    }`}
                >
                    <Check className="w-3.5 h-3.5" />
                    {options.first.label}
                </Button>
                <Button
                    size="sm"
                    variant={
                        selected === options.second.confirmed
                            ? "default"
                            : "outline"
                    }
                    onClick={() => setChoice(options.second.confirmed)}
                    disabled={answering || initializing}
                    className={`flex-1 gap-1 ${
                        selected === options.second.confirmed
                            ? "bg-red-600 hover:bg-red-500 text-white"
                            : "text-red-300 border-red-500/40 hover:bg-red-500/10"
                    }`}
                >
                    <X className="w-3.5 h-3.5" />
                    {options.second.label}
                </Button>
            </div>
            <Button
                size="sm"
                onClick={handleSend}
                disabled={answering || initializing || selected === null}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-1"
            >
                {answering || initializing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Send className="w-3.5 h-3.5" />
                )}
                Send answer
            </Button>
            <VetoButton
                question={question}
                disabled={answering || initializing}
            />
        </div>
    );
}

function UndoableCard({ question }: { question: CommittedQuestion }) {
    const [undoing, setUndoing] = useState(false);
    const [timeLeft, setTimeLeft] = useState(0);

    useEffect(() => {
        if (!question.answer) return;
        const deadline = new Date(question.answer.undoDeadline).getTime();

        const tick = () => {
            const remaining = Math.max(0, deadline - Date.now());
            setTimeLeft(remaining);
            if (remaining <= 0) return;
        };

        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [question.answer?.undoDeadline]);

    if (!question.answer || timeLeft <= 0) return null;

    const label = formatQuestionLabel(question);
    const confirmed = question.answer.answerData.confirmed as boolean;
    const seconds = Math.ceil(timeLeft / 1000);

    const handleUndo = async () => {
        if (!question.answer) return;
        setUndoing(true);
        try {
            await undoAnswer(question.answer.dbId);
        } catch (err: any) {
            console.error("Failed to undo:", err);
        } finally {
            setUndoing(false);
        }
    };

    return (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 mb-2">
            <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-300">
                    <span className="text-slate-500 text-xs">
                        Q{question.order}
                    </span>{" "}
                    {label}
                </span>
                <span
                    className={`text-xs font-mono ${confirmed ? "text-emerald-400" : "text-red-400"}`}
                >
                    {confirmed ? "Yes" : "No"}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleUndo}
                    disabled={undoing}
                    className="text-amber-400 hover:text-amber-300 gap-1"
                >
                    <Undo2 className="w-3.5 h-3.5" />
                    Undo
                </Button>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {seconds}s
                </span>
            </div>
        </div>
    );
}

function TentacleUnansweredCard({ question }: { question: CommittedQuestion }) {
    const [answering, setAnswering] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [options, setOptions] = useState<any[]>([]);
    const [selectedName, setSelectedName] = useState<string>("false");
    const drafts = useStore(answerDraftSelections);

    const sentAt = new Date(question.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });

    const label = formatQuestionLabel(question);

    useEffect(() => {
        let cancelled = false;

        const loadOptions = async () => {
            const qData = question.questionData as any;
            const allFeatures =
                qData.locationType === "custom"
                    ? (qData.places ?? [])
                    : (await findTentacleLocations(qData)).features;

            const filteredFeatures = (() => {
                if (
                    qData.lat === null ||
                    qData.lng === null ||
                    qData.radius === undefined ||
                    qData.radius === null
                ) {
                    return allFeatures;
                }

                const center = turf.point([qData.lng, qData.lat]);
                return allFeatures.filter((feature: any) => {
                    const coords =
                        feature?.geometry?.coordinates ??
                        (feature?.properties?.lon && feature?.properties?.lat
                            ? [feature.properties.lon, feature.properties.lat]
                            : null);

                    if (!coords) return false;

                    const pt = turf.point(coords);
                    const dist = turf.distance(center, pt, {
                        units: qData.unit,
                    });
                    return dist <= qData.radius;
                });
            })();

            if (cancelled) return;
            setOptions(filteredFeatures);

            const existing = drafts[question.dbId];
            if (existing?.selectedTentacleName) {
                setSelectedName(existing.selectedTentacleName);
                setInitializing(false);
                return;
            }

            const suggested = await deriveSuggestedTentacleSelection(question);
            if (cancelled) return;

            const existingNameSet = new Set(
                filteredFeatures.map((f: any) =>
                    String(f?.properties?.name ?? ""),
                ),
            );
            const fallbackName =
                suggested.selectedTentacleName === "false" ||
                existingNameSet.has(suggested.selectedTentacleName)
                    ? suggested.selectedTentacleName
                    : "false";

            const selectedLocation =
                fallbackName === "false"
                    ? false
                    : (filteredFeatures.find(
                          (f: any) =>
                              String(f?.properties?.name ?? "") ===
                              fallbackName,
                      ) ?? false);

            setSelectedName(fallbackName);
            setDraftAnswerSelection(question, {
                confirmed: deriveTentacleConfirmed(
                    (question.questionData as any).location,
                    selectedLocation,
                ),
                selectedTentacleName: fallbackName,
                selectedTentacleLocation: selectedLocation,
            });
            setInitializing(false);
        };

        loadOptions().catch(() => {
            if (!cancelled) {
                setOptions([]);
                setSelectedName("false");
                setDraftAnswerSelection(question, {
                    confirmed: deriveTentacleConfirmed(
                        (question.questionData as any).location,
                        false,
                    ),
                    selectedTentacleName: "false",
                    selectedTentacleLocation: false,
                });
                setInitializing(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [question.dbId]);

    const onValueChange = (value: string) => {
        const selectedLocation =
            value === "false"
                ? false
                : (options.find(
                      (feature: any) =>
                          String(feature?.properties?.name ?? "") === value,
                  ) ?? false);

        setSelectedName(value);
        setDraftAnswerSelection(question, {
            confirmed: deriveTentacleConfirmed(
                (question.questionData as any).location,
                selectedLocation,
            ),
            selectedTentacleName: value,
            selectedTentacleLocation: selectedLocation,
        });
    };

    const handleSend = async () => {
        const draft = drafts[question.dbId];
        const answerData: DraftAnswerSelection =
            draft && typeof draft.confirmed === "boolean"
                ? draft
                : {
                      confirmed: deriveTentacleConfirmed(
                          (question.questionData as any).location,
                          false,
                      ),
                      selectedTentacleName: "false",
                      selectedTentacleLocation: false,
                  };

        setAnswering(true);
        try {
            await answerQuestion(question.dbId, answerData);
            clearDraftAnswerSelection(question.dbId);
        } catch (err: any) {
            console.error("Failed to answer:", err);
        } finally {
            setAnswering(false);
        }
    };

    return (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-2">
            <div className="text-sm text-slate-300 mb-1">
                <span className="text-slate-500 text-xs">
                    Q{question.order}
                </span>{" "}
                {label}
            </div>
            <div className="text-xs text-slate-500 mb-2">Sent at {sentAt}</div>
            <div className="mb-2">
                <Select
                    trigger="Location"
                    options={{
                        false: "Not Within",
                        ...mapToObj(options, (feature: any) => [
                            String(feature?.properties?.name ?? "Unknown"),
                            String(feature?.properties?.name ?? "Unknown"),
                        ]),
                    }}
                    value={selectedName as any}
                    onValueChange={onValueChange as any}
                    disabled={answering || initializing}
                />
            </div>
            <Button
                size="sm"
                onClick={handleSend}
                disabled={answering || initializing}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-1"
            >
                {answering || initializing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Send className="w-3.5 h-3.5" />
                )}
                Send answer
            </Button>{" "}
            <VetoButton
                question={question}
                disabled={answering || initializing}
            />{" "}
        </div>
    );
}

function VetoButton({
    question,
    disabled,
}: {
    question: CommittedQuestion;
    disabled?: boolean;
}) {
    const [vetoing, setVetoing] = useState(false);

    const handleVeto = async () => {
        setVetoing(true);
        try {
            await vetoQuestion(question.dbId);
        } catch (err: any) {
            console.error("Failed to veto:", err);
            setVetoing(false);
        }
    };

    return (
        <Button
            size="sm"
            variant="ghost"
            onClick={handleVeto}
            disabled={disabled || vetoing}
            className="w-full mt-1 gap-1 text-red-400/80 hover:text-red-300 hover:bg-red-500/10"
        >
            {vetoing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
                <Ban className="w-3.5 h-3.5" />
            )}
            Veto question
        </Button>
    );
}

function formatQuestionLabel(q: CommittedQuestion): string {
    const type = q.questionType;
    const data = q.questionData;

    switch (type) {
        case "radius": {
            const within = data.within ? "Within" : "Outside";
            return `${within} ${data.radius} ${data.unit} radius`;
        }
        case "thermometer":
            return `Thermometer: ${data.warmer ? "Warmer" : "Colder"}`;
        case "tentacles":
            return `Tentacles: ${String(data.locationType ?? "custom")}`;
        case "matching":
            return `Matching: ${String(data.type ?? "zone")} — ${data.same ? "Same" : "Different"}`;
        case "measuring":
            return `Measuring: ${String(data.type ?? "coastline")} — ${data.hiderCloser ? "Closer" : "Further"}`;
        default:
            return `${type} question`;
    }
}

function getAnswerOptions(question: CommittedQuestion): {
    first: { label: string; confirmed: boolean };
    second: { label: string; confirmed: boolean };
} {
    const d = question.questionData as Record<string, unknown>;

    switch (question.questionType) {
        case "radius": {
            const proposition = !!d.within;
            return {
                first: {
                    label: "Outside",
                    confirmed: proposition === false,
                },
                second: {
                    label: "Inside",
                    confirmed: proposition === true,
                },
            };
        }
        case "thermometer": {
            const proposition = !!d.warmer;
            return {
                first: {
                    label: "Colder",
                    confirmed: proposition === false,
                },
                second: {
                    label: "Warmer",
                    confirmed: proposition === true,
                },
            };
        }
        case "measuring": {
            const proposition = !!d.hiderCloser;
            return {
                first: {
                    label: "Hider Further",
                    confirmed: proposition === false,
                },
                second: {
                    label: "Hider Closer",
                    confirmed: proposition === true,
                },
            };
        }
        case "matching": {
            const proposition = !!d.same;
            return {
                first: {
                    label: "Different",
                    confirmed: proposition === false,
                },
                second: {
                    label: "Same",
                    confirmed: proposition === true,
                },
            };
        }
        default:
            return {
                first: { label: "Yes", confirmed: true },
                second: { label: "No", confirmed: false },
            };
    }
}
