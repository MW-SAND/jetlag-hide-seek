import {
    CacheType,
    clearCache,
    determineName,
    geocode,
    type OpenStreetMap,
} from "@jetlag/geo/api";
import { useStore } from "@nanostores/react";
import {
    ChevronsUpDown,
    LucideMinusSquare,
    LucidePlusSquare,
    LucideX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useDebounce } from "@/hooks/useDebounce";
import {
    additionalMapGeoLocations,
    isLoading,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
    questions,
} from "@/lib/context";
import { cn } from "@/lib/utils";

import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

/** "City · Netherlands"-style subtitle for a search result. */
function placeKind(result: OpenStreetMap): string {
    const p = result.properties as any;
    const kind = String(p.type ?? p.osm_value ?? "place").replace(/_/g, " ");
    return [kind, p.country].filter(Boolean).join(" · ");
}

export const PlacePicker = ({
    className = "",
    mode = "replace",
}: {
    /** replace: picking a place sets the area. combine: add/subtract regions. */
    mode?: "replace" | "combine";
    value?: OpenStreetMap | null;
    debounce?: number;
    placeholder?: string;
    language?: string;
    className?: string;
}) => {
    const $mapGeoLocation = useStore(mapGeoLocation);
    const $additionalMapGeoLocations = useStore(additionalMapGeoLocations);
    const $polyGeoJSON = useStore(polyGeoJSON);
    const $isLoading = useStore(isLoading);
    const [open, setOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const debouncedValue = useDebounce<string>(inputValue);
    const [results, setResults] = useState<OpenStreetMap[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (debouncedValue.trim() === "") {
            setResults([]);
            setError(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(false);
        setResults([]);
        geocode(debouncedValue.trim(), "en")
            .then((x) => {
                if (cancelled) return;
                setResults(x);
                setLoading(false);
            })
            .catch((e) => {
                if (cancelled) return;
                console.warn("Place search failed", e);
                setError(true);
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedValue]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        "w-full justify-between text-left font-medium",
                        className,
                    )}
                    data-testid="place-picker"
                >
                    {$polyGeoJSON
                        ? "Custom drawn area"
                        : $mapGeoLocation &&
                            $mapGeoLocation.properties &&
                            $mapGeoLocation.properties.name
                          ? [
                                $mapGeoLocation,
                                ...$additionalMapGeoLocations.map(
                                    (x) => x.location,
                                ),
                            ]
                                .map((location) => determineName(location))
                                .join("; ")
                          : "Choose a play area"}
                    <ChevronsUpDown className="opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[min(92vw,420px)] p-0 overflow-hidden"
                data-testid="place-picker-content"
            >
                {mode === "combine" && (
                    <>
                        <div
                            className={cn(
                                "font-normal flex flex-col",
                                $polyGeoJSON &&
                                    "bg-muted text-muted-foreground",
                            )}
                        >
                            {[
                                {
                                    location: $mapGeoLocation,
                                    added: true,
                                    base: true,
                                },
                                ...$additionalMapGeoLocations,
                            ].map((location, index) => (
                                <div
                                    className={cn(
                                        "flex justify-between items-center px-3 py-2",
                                        index % 2 === 1 && "bg-white/[0.03]",
                                        !$polyGeoJSON &&
                                            "transition-colors duration-200 hover:bg-white/10",
                                    )}
                                    key={determineName(location.location)}
                                >
                                    <span className="w-[78%] text-ellipsis">
                                        {determineName(location.location)}
                                    </span>
                                    <div
                                        className={cn(
                                            "flex flex-row gap-2 *:stroke-[1.5]",
                                            $polyGeoJSON && "hidden",
                                        )}
                                    >
                                        {!location.base &&
                                            (location.added ? (
                                                <LucidePlusSquare
                                                    className={cn(
                                                        "text-green-700 cursor-pointer",
                                                        $isLoading &&
                                                            "text-muted-foreground cursor-not-allowed",
                                                    )}
                                                    onClick={() => {
                                                        if ($isLoading) return;

                                                        location.added = false;

                                                        additionalMapGeoLocations.set(
                                                            [
                                                                ...$additionalMapGeoLocations,
                                                            ],
                                                        );
                                                        mapGeoJSON.set(null);
                                                        polyGeoJSON.set(null);
                                                        questions.set([
                                                            ...questions.get(),
                                                        ]);
                                                    }}
                                                />
                                            ) : (
                                                <LucideMinusSquare
                                                    className={cn(
                                                        "text-red-700 cursor-pointer",
                                                        $isLoading &&
                                                            "text-muted-foreground cursor-not-allowed",
                                                    )}
                                                    onClick={() => {
                                                        if ($isLoading) return;

                                                        location.added = true;

                                                        additionalMapGeoLocations.set(
                                                            [
                                                                ...$additionalMapGeoLocations,
                                                            ],
                                                        );
                                                        mapGeoJSON.set(null);
                                                        polyGeoJSON.set(null);
                                                        questions.set([
                                                            ...questions.get(),
                                                        ]);
                                                    }}
                                                />
                                            ))}
                                        <LucideX
                                            className={cn(
                                                "scale-[90%] text-slate-300 cursor-pointer hover:bg-white/10 rounded-full transition-colors duration-200",
                                            )}
                                            onClick={() => {
                                                if (location.base) {
                                                    const addedLocations =
                                                        $additionalMapGeoLocations.filter(
                                                            (x) =>
                                                                x.added ===
                                                                true,
                                                        );

                                                    if (
                                                        addedLocations.length >
                                                        0
                                                    ) {
                                                        addedLocations[0].base =
                                                            true;
                                                        additionalMapGeoLocations.set(
                                                            additionalMapGeoLocations
                                                                .get()
                                                                .filter(
                                                                    (x) =>
                                                                        x.base !==
                                                                        true,
                                                                ),
                                                        );
                                                        mapGeoLocation.set(
                                                            addedLocations[0]
                                                                .location,
                                                        );
                                                    } else {
                                                        return toast.error(
                                                            "Please add another location in addition mode.",
                                                            {
                                                                autoClose: 3000,
                                                            },
                                                        );
                                                    }
                                                } else {
                                                    additionalMapGeoLocations.set(
                                                        $additionalMapGeoLocations.filter(
                                                            (x) =>
                                                                x.location
                                                                    .properties
                                                                    .osm_id !==
                                                                location
                                                                    .location
                                                                    .properties
                                                                    .osm_id,
                                                        ),
                                                    );
                                                }

                                                mapGeoJSON.set(null);
                                                polyGeoJSON.set(null);
                                                questions.set([
                                                    ...questions.get(),
                                                ]);
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Separator className="h-[0.5px]" />
                    </>
                )}
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search place..."
                        value={inputValue}
                        onValueChange={setInputValue}
                    />
                    <CommandList>
                        <CommandEmpty>
                            {loading ? (
                                <>Searching…</>
                            ) : error ? (
                                <>
                                    Place search is unavailable right now. Try
                                    again in a moment.
                                </>
                            ) : (
                                "No places found. Try a city, region or country."
                            )}
                        </CommandEmpty>
                        <CommandGroup>
                            {results.map((result) => (
                                <CommandItem
                                    key={`${result.properties.osm_id}${result.properties.name}`}
                                    onSelect={() => {
                                        if (mode === "replace") {
                                            mapGeoLocation.set(result);
                                            additionalMapGeoLocations.set([]);
                                            mapGeoJSON.set(null);
                                            polyGeoJSON.set(null);
                                            setInputValue("");
                                            setOpen(false);
                                            return;
                                        }
                                        additionalMapGeoLocations.set([
                                            ...additionalMapGeoLocations.get(),
                                            {
                                                added: true,
                                                location: result,
                                                base: false,
                                            },
                                        ]);

                                        mapGeoJSON.set(null);
                                        polyGeoJSON.set(null);
                                        questions.set([...questions.get()]);
                                    }}
                                    className="cursor-pointer"
                                    data-testid="place-result"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate">
                                            {determineName(result)}
                                        </div>
                                        <div className="truncate text-xs capitalize text-slate-400">
                                            {placeKind(result)}
                                        </div>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                    {mode === "combine" && (
                        <Button
                            variant="outline"
                            className="font-normal hover:bg-white/10"
                            onClick={() => {
                                mapGeoJSON.set(null);
                                polyGeoJSON.set(null);
                                questions.set([]);
                                clearCache(CacheType.ZONE_CACHE);
                            }}
                        >
                            Clear Questions & Cache
                        </Button>
                    )}
                    {$polyGeoJSON && (
                        <Button
                            variant="outline"
                            className="font-normal hover:bg-white/10"
                            onClick={() => {
                                polyGeoJSON.set(null);
                                mapGeoJSON.set(null);
                                questions.set([...questions.get()]);
                            }}
                        >
                            Reuse Preset Locations
                        </Button>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
};
