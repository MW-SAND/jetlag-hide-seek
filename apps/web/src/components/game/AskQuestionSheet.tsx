import { useStore } from "@nanostores/react";
import { ClipboardPaste } from "lucide-react";

import { QuestionKindIcon } from "@/components/game/QuestionKindIcon";
import { Button } from "@/components/ui/button";
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import { askQuestion, pasteQuestion, QUESTION_KINDS } from "@/lib/ask";
import { askOpen } from "@/lib/ui-store";

/** Bottom sheet with the five question types: one tap adds one. */
export function AskQuestionSheet() {
    const open = useStore(askOpen);
    return (
        <Drawer open={open} onOpenChange={askOpen.set}>
            <DrawerContent data-testid="ask-sheet">
                <div className="safe-bottom mx-auto w-full max-w-lg px-4 pb-4">
                    <DrawerHeader className="px-0 text-left">
                        <DrawerTitle className="text-xl text-white">
                            Ask a question
                        </DrawerTitle>
                        <DrawerDescription className="text-slate-400">
                            It&apos;s placed at the centre of the map. Drag the
                            pin to adjust.
                        </DrawerDescription>
                    </DrawerHeader>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {QUESTION_KINDS.map((kind) => (
                            <button
                                key={kind.id}
                                type="button"
                                data-testid={`ask-${kind.id}`}
                                onClick={() => {
                                    if (askQuestion(kind.id) !== null)
                                        askOpen.set(false);
                                }}
                                className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition-colors hover:bg-white/[0.08] active:scale-[0.99]"
                            >
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15">
                                    <QuestionKindIcon
                                        kind={kind.id}
                                        className="h-5 w-5 text-blue-300"
                                    />
                                </span>
                                <span>
                                    <span className="block text-sm font-semibold text-white">
                                        {kind.title}
                                    </span>
                                    <span className="block text-xs text-slate-400">
                                        {kind.description}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="ghost"
                        className="mt-3 w-full text-slate-300"
                        onClick={async () => {
                            if (await pasteQuestion()) askOpen.set(false);
                        }}
                    >
                        <ClipboardPaste />
                        Paste a copied question
                    </Button>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
