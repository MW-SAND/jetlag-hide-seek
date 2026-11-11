/** UI state for the game screen (panel tab, sheet height, open dialogs). */
import { atom } from "nanostores";

export type PanelTab = "answer" | "questions" | "zones";
export type SheetSnap = "peek" | "half" | "full";

/** Current pixel height of the phone bottom sheet (0 on desktop). */
export const sheetHeight = atom<number>(0);

/** Background loading messages ("Loading map data…") shown in the status pill. */
export const loadingMessages = atom<Record<number, string>>({});
let loadingSeq = 0;
export function startLoading(message: string): () => void {
    const id = ++loadingSeq;
    loadingMessages.set({ ...loadingMessages.get(), [id]: message });
    return () => {
        const next = { ...loadingMessages.get() };
        delete next[id];
        loadingMessages.set(next);
    };
}

export const panelTab = atom<PanelTab>("questions");
export const sheetSnap = atom<SheetSnap>("peek");
export const askOpen = atom<boolean>(false);
export const menuOpen = atom<boolean>(false);
/** Key of a question card to scroll to and expand (set after adding one). */
export const focusQuestionKey = atom<number | null>(null);

/** Show a panel tab, expanding the mobile sheet so its content is visible. */
export function openPanel(tab: PanelTab, snap: SheetSnap = "half") {
    panelTab.set(tab);
    if (sheetSnap.get() === "peek" || snap === "full") sheetSnap.set(snap);
}
