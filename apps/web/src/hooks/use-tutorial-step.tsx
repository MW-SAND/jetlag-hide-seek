import { useStore } from "@nanostores/react";

import { showTutorial, tutorialStep } from "@/lib/context";
import { gameSession } from "@/lib/multiplayer";

export function useTutorialStep<T>(
    defaultValue: T,
    steps: number[],
    trueReplacement: T = true as T,
    falseReplacement: T = false as T,
): T {
    const $showTutorial = useStore(showTutorial);
    const $tutorialStep = useStore(tutorialStep);
    const $session = useStore(gameSession);

    // In multiplayer, never override UI state with tutorial logic.
    // TutorialDialog is suppressed in multiplayer, so the step never advances —
    // without this guard every tutorial-controlled element gets locked in its
    // "wrong step" state (e.g. PlacePicker forced closed, sidebar forced collapsed).
    if ($showTutorial && !$session) {
        return steps.includes($tutorialStep)
            ? trueReplacement
            : falseReplacement;
    }
    return defaultValue;
}
