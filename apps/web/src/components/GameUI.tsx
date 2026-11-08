import { lazy, Suspense } from "react";
import { ToastContainer } from "react-toastify";

import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Map } from "@/components/Map";
import { OptionDrawers } from "@/components/OptionDrawers";
import { PlacePicker } from "@/components/PlacePicker";
import { PlayerList } from "@/components/PlayerList";
import { QuestionSidebar } from "@/components/QuestionSidebar";
import {
    SidebarProvider as SidebarProviderL,
    SidebarTrigger as SidebarTriggerL,
} from "@/components/ui/sidebar-l";
import {
    SidebarProvider as SidebarProviderR,
    SidebarTrigger as SidebarTriggerR,
} from "@/components/ui/sidebar-r";
import { ZoneSidebar } from "@/components/ZoneSidebar";

const TutorialDialog = lazy(() =>
    import("@/components/TutorialDialog").then((m) => ({
        default: m.TutorialDialog,
    })),
);

/** The map screen (formerly src/pages/index.astro). */
export default function GameUI() {
    return (
        <div id="game-ui">
            <SidebarProviderL>
                <SidebarProviderR defaultOpen={false}>
                    <QuestionSidebar />
                    <main className="flex flex-col flex-grow group">
                        <div
                            className="flex justify-center"
                            id="map-modal-dialog-container-leaflet"
                        >
                            <div className="w-full h-full relative">
                                <div
                                    className="absolute top-[72px] md:top-2 left-2 z-[1030] group-[.fullscreen]:hidden"
                                    data-tutorial-id="left-sidebar-trigger"
                                >
                                    <SidebarTriggerL />
                                </div>
                                <PlayerList />
                                <div className="absolute bottom-2 left-2 z-[1030] group-[.fullscreen]:hidden">
                                    <ConnectionStatus />
                                </div>
                                <div className="absolute top-[72px] md:top-2 right-2 z-[1030] group-[.fullscreen]:hidden">
                                    <SidebarTriggerR />
                                </div>
                                <div className="flex flex-shrink max-w-fit z-[1030] absolute left-4 right-0 m-auto group-[.fullscreen]:hidden">
                                    <PlacePicker className="m-4 overflow-hidden" />
                                </div>
                                <div className="bottom-5 right-2 mx-auto mb-2 w-fit absolute z-[1030] group-[.fullscreen]:hidden">
                                    <OptionDrawers />
                                </div>
                                <Map className="w-full group-[.fullscreen]:w-full group-[.fullscreen]:h-full" />
                            </div>
                        </div>
                    </main>
                    <ZoneSidebar />
                    <Suspense fallback={null}>
                        <TutorialDialog />
                    </Suspense>
                </SidebarProviderR>
            </SidebarProviderL>
            <ToastContainer />
        </div>
    );
}
