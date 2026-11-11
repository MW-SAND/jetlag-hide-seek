import type { PlayerRole } from "@jetlag/shared";
import { Eye, EyeOff, Loader2, LogIn, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/** Big two-option role picker (≥ 64px touch targets). */
export function RolePicker({
    value,
    onChange,
}: {
    value: PlayerRole;
    onChange: (role: PlayerRole) => void;
}) {
    const options = [
        {
            role: "seeker" as const,
            label: "Seeker",
            hint: "Ask questions",
            Icon: Eye,
            active: "border-blue-400/70 bg-blue-500/15 text-blue-100",
            icon: "text-blue-300",
        },
        {
            role: "hider" as const,
            label: "Hider",
            hint: "Answer & hide",
            Icon: EyeOff,
            active: "border-emerald-400/70 bg-emerald-500/15 text-emerald-100",
            icon: "text-emerald-300",
        },
    ];
    return (
        <div
            role="radiogroup"
            aria-label="Your role"
            className="grid grid-cols-2 gap-2"
        >
            {options.map(({ role, label, hint, Icon, active, icon }) => (
                <button
                    key={role}
                    type="button"
                    role="radio"
                    aria-checked={value === role}
                    data-testid={`role-${role}`}
                    onClick={() => onChange(role)}
                    className={cn(
                        "flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all active:scale-[0.98]",
                        value === role
                            ? active
                            : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]",
                    )}
                >
                    <Icon
                        className={cn(
                            "h-5 w-5 shrink-0",
                            value === role ? icon : "text-slate-500",
                        )}
                    />
                    <span>
                        <span className="block text-sm font-semibold">
                            {label}
                        </span>
                        <span className="block text-xs text-slate-400">
                            {hint}
                        </span>
                    </span>
                </button>
            ))}
        </div>
    );
}

export function SubmitIcon({
    loading,
    mode,
}: {
    loading: boolean;
    mode: "create" | "join";
}) {
    if (loading) return <Loader2 className="animate-spin" />;
    return mode === "create" ? <Plus /> : <LogIn />;
}
