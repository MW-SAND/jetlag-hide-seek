/**
 * Seeker controls for the question sidebar in multiplayer.
 * Shows a "Send Question" button for each drafted question,
 * and a committed questions list with answer status.
 */
import type { Question } from "@jetlag/geo/schema";
import { useStore } from "@nanostores/react";
import { Ban, Check, Loader2, Send, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
    commitQuestion,
    type CommittedQuestion,
    committedQuestions,
} from "@/lib/question-store";

/** Button shown next to each draft question card */
export function CommitQuestionButton({ question }: { question: Question }) {
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCommit = async () => {
        setSending(true);
        setError(null);
        try {
            await commitQuestion(question);
        } catch (err: any) {
            setError(err.message || "Failed to send");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="mt-1">
            <Button
                size="sm"
                onClick={handleCommit}
                disabled={sending}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white gap-1.5 text-xs disabled:opacity-40"
            >
                {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Send className="w-3.5 h-3.5" />
                )}
                {sending ? "Sending..." : "Send to Hider"}
            </Button>
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>
    );
}

/** Shows all committed questions and their answer status */
export function CommittedQuestionsList() {
    const committed = useStore(committedQuestions);

    if (committed.length === 0) return null;

    return (
        <div className="mb-3">
            <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2 px-3">
                Sent Questions ({committed.length})
            </h3>
            {committed.map((q) => (
                <CommittedQuestionRow key={q.dbId} question={q} />
            ))}
        </div>
    );
}

function CommittedQuestionRow({ question }: { question: CommittedQuestion }) {
    const vetoed = question.veto !== null;
    const hasAnswer = question.answer !== null;
    const confirmed = hasAnswer
        ? (question.answer!.answerData.confirmed as boolean)
        : null;

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="text-slate-500 text-xs w-6">
                Q{question.order}
            </span>
            <span
                className={`flex-1 truncate ${vetoed ? "text-slate-500 line-through" : "text-slate-300"}`}
            >
                {formatType(question.questionType)}
            </span>
            {vetoed ? (
                <span
                    className="flex items-center gap-0.5 text-xs font-medium text-red-400"
                    title={question.veto!.reason ?? "Vetoed by hider"}
                >
                    <Ban className="w-3 h-3" />
                    Vetoed
                </span>
            ) : hasAnswer ? (
                <span
                    className={`flex items-center gap-0.5 text-xs font-medium ${
                        confirmed ? "text-emerald-400" : "text-red-400"
                    }`}
                >
                    {confirmed ? (
                        <Check className="w-3 h-3" />
                    ) : (
                        <X className="w-3 h-3" />
                    )}
                    {confirmed ? "Yes" : "No"}
                </span>
            ) : (
                <span className="text-xs text-amber-400/70 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Pending
                </span>
            )}
        </div>
    );
}

function formatType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).replace(/[-_]/g, " ");
}
