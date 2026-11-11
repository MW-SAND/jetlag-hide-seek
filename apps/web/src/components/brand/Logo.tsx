import { cn } from "@/lib/utils";

/** Brand mark: a map pin with radar rings. */
export function Logo({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 64 64"
            className={cn("h-12 w-12", className)}
            aria-hidden="true"
        >
            <defs>
                <linearGradient id="jl-logo" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#60a5fa" />
                    <stop offset="1" stopColor="#34d399" />
                </linearGradient>
            </defs>
            <rect width="64" height="64" rx="18" fill="#0f172a" />
            <circle
                cx="32"
                cy="30"
                r="20"
                fill="none"
                stroke="url(#jl-logo)"
                strokeOpacity="0.25"
                strokeWidth="2"
            />
            <circle
                cx="32"
                cy="30"
                r="12"
                fill="none"
                stroke="url(#jl-logo)"
                strokeOpacity="0.5"
                strokeWidth="2"
            />
            <path
                d="M32 14c-6.6 0-12 5.2-12 11.7C20 34.5 32 48 32 48s12-13.5 12-22.3C44 19.2 38.6 14 32 14z"
                fill="url(#jl-logo)"
            />
            <circle cx="32" cy="26" r="4.5" fill="#0f172a" />
        </svg>
    );
}
