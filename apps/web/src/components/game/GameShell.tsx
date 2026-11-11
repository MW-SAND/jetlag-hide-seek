import { AskQuestionSheet } from "@/components/game/AskQuestionSheet";
import { GameMenu } from "@/components/game/GameMenu";
import { GamePanel } from "@/components/game/GamePanel";
import { MapButtons } from "@/components/game/MapButtons";
import { TopBar } from "@/components/game/TopBar";
import { Map } from "@/components/Map";

/** The in-game screen: full-screen map with floating controls. */
export default function GameShell() {
    return (
        <div
            id="map-modal-dialog-container-leaflet"
            className="fixed inset-0 overflow-hidden bg-slate-950"
            data-testid="game-shell"
        >
            <div className="absolute inset-0">
                <Map className="h-full w-full" />
            </div>
            <TopBar />
            <MapButtons />
            <GamePanel />
            <AskQuestionSheet />
            <GameMenu />
        </div>
    );
}
