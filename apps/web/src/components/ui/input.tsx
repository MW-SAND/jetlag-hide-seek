import * as React from "react";

import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";

const RawInput = React.forwardRef<
    HTMLInputElement,
    React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => {
    return (
        <input
            type={type}
            className={cn(
                "flex h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-base text-foreground ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            ref={ref}
            {...props}
        />
    );
});
RawInput.displayName = "RawInput";

type DebouncedInputProps = React.ComponentProps<"input"> & {
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    debounce?: number;
};

const Input = React.forwardRef<HTMLInputElement, DebouncedInputProps>(
    ({ onChange, debounce = 500, value, ...props }, ref) => {
        const [internalValue, setInternalValue] = React.useState(value ?? "");
        const debouncedValue = useDebounce(internalValue, debounce);

        React.useEffect(() => {
            if (debouncedValue !== value && onChange) {
                const event = {
                    ...({} as React.ChangeEvent<HTMLInputElement>),
                    target: { value: debouncedValue },
                };
                onChange(event as React.ChangeEvent<HTMLInputElement>);
            }
        }, [debouncedValue]);

        React.useEffect(() => {
            setInternalValue(value ?? "");
        }, [value]);

        return (
            <RawInput
                {...props}
                ref={ref}
                value={internalValue}
                onChange={(e) => setInternalValue(e.target.value)}
            />
        );
    },
);
Input.displayName = "Input";

export { Input, RawInput };
