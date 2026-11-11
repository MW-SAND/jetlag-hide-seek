/**
 * Error boundary wrapping all multiplayer overlay components.
 * Catches render/lifecycle errors in AppRoot, LandingPage, GameLobby, etc.
 * and shows a recovery UI instead of a blank crash.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { leaveGame } from "@/lib/multiplayer";

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

export class MultiplayerErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("[MultiplayerErrorBoundary] Caught error:", error, info);
    }

    handleReset = () => {
        // Best-effort: try to leave the game so stores are clean before reloading
        try {
            leaveGame();
        } catch {
            // ignore — we're already in a broken state
        }
        this.setState({ error: null });
    };

    render() {
        if (this.state.error) {
            return (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl">
                        <div className="text-3xl mb-3">⚠️</div>
                        <h2 className="text-white font-semibold text-lg mb-2">
                            Multiplayer Error
                        </h2>
                        <p className="text-zinc-400 text-sm mb-1">
                            Something went wrong with the connection.
                        </p>
                        <p className="text-zinc-600 text-xs mb-6 font-mono break-all">
                            {this.state.error.message}
                        </p>
                        <Button
                            onClick={this.handleReset}
                            className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                        >
                            ← Back to Home
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
