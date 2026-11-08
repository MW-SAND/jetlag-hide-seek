/**
 * Bridge between multiplayer question-store and the existing local
 * `questions` context atom used by Map.tsx.
 *
 * When in a multiplayer game:
 * - Answered committed questions → parsed and pushed into the `questions` atom
 * - The existing Map.tsx rendering pipeline picks them up automatically
 *
 * This runs as a React component (renders null) placed next to the map.
 */
import { questionSchema } from "@jetlag/geo/schema";
import { useStore } from "@nanostores/react";
import { useEffect, useRef } from "react";

import { questions } from "@/lib/context";
import { gameSession } from "@/lib/multiplayer";
import { answeredQuestions } from "@/lib/question-store";

export function MultiplayerQuestionSync() {
    const session = useStore(gameSession);
    const answered = useStore(answeredQuestions);
    const prevLengthRef = useRef(0);

    useEffect(() => {
        if (!session || session.phase !== "playing") return;

        // Convert answered committed questions back into local Question objects.
        // Each committed question has { questionType, questionData, answer }.
        // The answer.answerData.confirmed tells us the hider's yes/no.
        // We need to flip the question's boolean field if the answer is "no".
        const localQuestions = answered
            .map((cq) => {
                const data = { ...cq.questionData };
                const confirmed = cq.answer!.answerData.confirmed as boolean;

                // If not confirmed, flip the relevant boolean on the question data
                if (!confirmed) {
                    switch (cq.questionType) {
                        case "radius":
                            data.within = !data.within;
                            break;
                        case "thermometer":
                            data.warmer = !data.warmer;
                            break;
                        case "measuring":
                            data.hiderCloser = !data.hiderCloser;
                            break;
                        case "matching":
                            data.same = !data.same;
                            break;
                        // tentacles: location becomes false if not confirmed
                        case "tentacles":
                            if (!confirmed) {
                                data.location = false;
                            }
                            break;
                    }
                }

                // Lock the question (drag: false) since it's committed
                data.drag = false;
                data.collapsed = true;

                try {
                    return questionSchema.parse({
                        id: cq.questionType,
                        key: hashCode(cq.dbId),
                        data,
                    });
                } catch {
                    // If parsing fails (schema mismatch), skip
                    return null;
                }
            })
            .filter(Boolean);

        // Only update if the set of answered questions actually changed
        if (
            localQuestions.length !== prevLengthRef.current ||
            localQuestions.length !== questions.get().length
        ) {
            prevLengthRef.current = localQuestions.length;
            questions.set(localQuestions as any);
        }
    }, [session, answered]);

    return null;
}

/** Stable numeric hash from a string (for question keys) */
function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash) / 2147483647; // normalize to 0-1 like Math.random keys
}
