/**
 * Multiplayer-aware sidebar overlay.
 * - For seekers: adds "Send to Hider" button under each question + committed questions list
 * - For hiders: shows the HiderAnswerPanel in the sidebar
 * Injected alongside the existing QuestionSidebar when in multiplayer game mode.
 */
import { useStore } from "@nanostores/react";
import { useEffect } from "react";

import { currentPlayer, gameSession } from "@/lib/multiplayer";
import {
    fetchCommittedQuestions,
    subscribeToQuestions,
} from "@/lib/question-store";

import { HiderAnswerPanel } from "./HiderAnswerPanel";
import { CommittedQuestionsList } from "./SeekerQuestionControls";

/**
 * Placed inside the existing sidebar to add multiplayer sections.
 * Renders nothing if not in a multiplayer game.
 */
export function MultiplayerSidebarSection() {
    const session = useStore(gameSession);
    const player = useStore(currentPlayer);

    useEffect(() => {
        if (session?.phase === "playing") {
            subscribeToQuestions(session.gameId);
            fetchCommittedQuestions(session.gameId);
        }
    }, [session?.gameId, session?.phase]);

    if (!session || session.phase !== "playing") return null;

    const isHider = player?.role === "hider";

    return (
        <div className="px-2 py-3 border-t border-white/10">
            {isHider ? (
                <>
                    <h3 className="text-xs uppercase tracking-wider text-emerald-400/70 font-medium mb-2 px-1">
                        Hider Controls
                    </h3>
                    <HiderAnswerPanel />
                </>
            ) : (
                <>
                    <CommittedQuestionsList />
                </>
            )}
        </div>
    );
}
