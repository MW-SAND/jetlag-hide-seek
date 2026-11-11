/** Creating new questions (shared by the ask picker and the map's context menu). */
import * as turf from "@turf/turf";
import { toast } from "react-toastify";

import {
    addQuestion,
    defaultCustomQuestions,
    leafletMapContext,
    questions,
} from "./context";
import { focusQuestionKey, openPanel } from "./ui-store";

export type QuestionKind =
    | "radius"
    | "thermometer"
    | "matching"
    | "measuring"
    | "tentacles";

export const QUESTION_KINDS: {
    id: QuestionKind;
    title: string;
    description: string;
}[] = [
    {
        id: "radius",
        title: "Radius",
        description: "Is the hider within a distance of us?",
    },
    {
        id: "thermometer",
        title: "Thermometer",
        description: "Did we get hotter or colder?",
    },
    {
        id: "matching",
        title: "Matching",
        description: "Is the hider's nearest X the same as ours?",
    },
    {
        id: "measuring",
        title: "Measuring",
        description: "Is the hider closer to X than us?",
    },
    {
        id: "tentacles",
        title: "Tentacles",
        description: "Which nearby place is the hider closest to?",
    },
];

function mapCenter() {
    const map = leafletMapContext.get();
    if (!map) return null;
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
}

/** Add a question at the map centre and open its card. Returns the new key. */
export function askQuestion(
    kind: QuestionKind,
    at = mapCenter(),
): number | null {
    if (!at) {
        toast.error("The map is still loading — try again in a moment.");
        return null;
    }
    const custom = defaultCustomQuestions.get();
    const { lat, lng } = at;
    switch (kind) {
        case "radius":
            addQuestion({ id: "radius", data: { lat, lng } });
            break;
        case "thermometer": {
            const destination = turf.destination([lng, lat], 5, 90, {
                units: "miles",
            });
            addQuestion({
                id: "thermometer",
                data: {
                    latA: lat,
                    lngA: lng,
                    latB: destination.geometry.coordinates[1],
                    lngB: destination.geometry.coordinates[0],
                },
            });
            break;
        }
        case "tentacles":
            addQuestion({
                id: "tentacles",
                data: custom
                    ? { lat, lng, locationType: "custom", places: [] }
                    : { lat, lng },
            });
            break;
        case "matching":
            addQuestion({
                id: "matching",
                data: custom
                    ? { lat, lng, type: "custom-points" }
                    : { lat, lng },
            });
            break;
        case "measuring":
            addQuestion({
                id: "measuring",
                data: custom
                    ? { lat, lng, type: "custom-measure" }
                    : { lat, lng },
            });
            break;
    }
    const added = questions.get().at(-1);
    if (!added) return null;
    focusQuestionKey.set(added.key);
    openPanel("questions", "half");
    return added.key;
}

/** Add a question copied as JSON (from another player's "copy" action). */
export async function pasteQuestion(): Promise<boolean> {
    try {
        const text = await navigator.clipboard.readText();
        const parsed = JSON.parse(text);
        addQuestion(
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? { ...parsed, key: Math.random() }
                : parsed,
        );
        const added = questions.get().at(-1);
        if (added) {
            focusQuestionKey.set(added.key);
            openPanel("questions", "half");
        }
        toast.success("Question added from clipboard", { autoClose: 1500 });
        return true;
    } catch {
        toast.error("No valid question found on the clipboard");
        return false;
    }
}
