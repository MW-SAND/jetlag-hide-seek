import { cn } from "@/lib/utils";

/** Accessible on/off row: label (and optional hint) on the left, toggle right. */
export function Switch({
    checked,
    onCheckedChange,
    label,
    description,
    disabled,
    className,
    testId,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label: string;
    description?: string;
    disabled?: boolean;
    className?: string;
    testId?: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            data-testid={testId}
            onClick={() => onCheckedChange(!checked)}
            className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-50",
                className,
            )}
        >
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">
                    {label}
                </span>
                {description && (
                    <span className="block text-xs text-slate-400">
                        {description}
                    </span>
                )}
            </span>
            <span
                aria-hidden="true"
                className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                    checked ? "bg-primary" : "bg-white/15",
                )}
            >
                <span
                    className={cn(
                        "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                        checked ? "translate-x-[22px]" : "translate-x-0.5",
                    )}
                />
            </span>
        </button>
    );
}
