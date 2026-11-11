import {
    CircleDot,
    GitCompareArrows,
    Network,
    Ruler,
    Thermometer,
} from "lucide-react";

const ICONS = {
    radius: CircleDot,
    thermometer: Thermometer,
    matching: GitCompareArrows,
    measuring: Ruler,
    tentacles: Network,
} as const;

export function QuestionKindIcon({
    kind,
    className,
}: {
    kind?: string;
    className?: string;
}) {
    const Icon = ICONS[(kind ?? "radius") as keyof typeof ICONS] ?? CircleDot;
    return <Icon className={className} aria-hidden="true" />;
}
