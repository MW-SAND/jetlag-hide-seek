import { useStore } from "@nanostores/react";
import { MessageCircleQuestion } from "lucide-react";

import {
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "@/components/QuestionCards";
import { questions, triggerLocalRefresh } from "@/lib/context";
import { currentPlayer } from "@/lib/multiplayer";

/** All questions on this device's map, newest last. */
export function QuestionList() {
    useStore(triggerLocalRefresh);
    const $questions = useStore(questions);
    const $player = useStore(currentPlayer);

    if ($questions.length === 0) {
        return (
            <div
                className="flex flex-col items-center gap-2 px-6 py-10 text-center"
                data-testid="questions-empty"
            >
                <MessageCircleQuestion className="h-8 w-8 text-slate-500" />
                <p className="text-sm font-medium text-slate-200">
                    No questions yet
                </p>
                <p className="text-xs text-slate-400">
                    {$player?.role === "hider"
                        ? "Questions from the seekers show up here once they're sent."
                        : "Tap “Ask a question”, place it on the map and send it to the hiders."}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2.5" data-testid="question-list">
            {$questions.map((question) => {
                const props = {
                    key: question.key,
                    questionKey: question.key,
                } as const;
                switch (question.id) {
                    case "radius":
                        return (
                            <RadiusQuestionComponent
                                {...props}
                                data={question.data}
                            />
                        );
                    case "thermometer":
                        return (
                            <ThermometerQuestionComponent
                                {...props}
                                data={question.data}
                            />
                        );
                    case "tentacles":
                        return (
                            <TentacleQuestionComponent
                                {...props}
                                data={question.data}
                            />
                        );
                    case "matching":
                        return (
                            <MatchingQuestionComponent
                                {...props}
                                data={question.data}
                            />
                        );
                    case "measuring":
                        return (
                            <MeasuringQuestionComponent
                                {...props}
                                data={question.data}
                            />
                        );
                    default:
                        return null;
                }
            })}
        </div>
    );
}
