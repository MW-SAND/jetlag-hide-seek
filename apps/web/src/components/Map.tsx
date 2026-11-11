import "leaflet/dist/leaflet.css";
import "leaflet-contextmenu/dist/leaflet.contextmenu.css";
import "leaflet-contextmenu";

import { snapshotGeoEnv } from "@jetlag/geo/env";
import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import * as L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
    MapContainer,
    ScaleControl,
    TileLayer,
    ZoomControl,
} from "react-leaflet";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    addQuestion,
    animateMapMovements,
    autoZoom,
    baseTileLayer,
    drawingQuestionKey,
    followMe,
    hiderMode,
    isLoading,
    leafletMapContext,
    mapGeoJSON,
    mapGeoLocation,
    permanentOverlay,
    planningModeEnabled,
    polyGeoJSON,
    questionFinishedMapData,
    questions,
    thunderforestApiKey,
    triggerLocalRefresh,
} from "@/lib/context";
import { gameSession, isHost, syncReady } from "@/lib/game-store";
import { ComputeCancelled, computeMapAsync } from "@/lib/geo-runtime";
import { questionsForMap } from "@/lib/question-store";
import { resolveTileStyle } from "@/lib/tiles";
import { cn } from "@/lib/utils";

import { DraggableMarkers } from "./DraggableMarkers";
import { PolygonDraw } from "./PolygonDraw";

// Module-level layer tracking (O(1) layer removal instead of eachLayer iteration)
// NOTE: Must use globalThis.Map because `export const Map` shadows the global Map constructor via TDZ
let eliminationLayer: L.GeoJSON | null = null;
const questionLayers = new globalThis.Map<number | string, L.GeoJSON>();

const getTileLayer = (tileLayer: string, thunderforestApiKey: string) => {
    const style = resolveTileStyle(tileLayer, thunderforestApiKey);
    return (
        <>
            <TileLayer
                key={style.id}
                attribution={style.attribution}
                url={style.url(thunderforestApiKey)}
                maxNativeZoom={style.maxNativeZoom}
                maxZoom={20}
                minZoom={2}
                noWrap
            />
            {style.overlayUrl && (
                <TileLayer
                    key={`${style.id}-labels`}
                    url={style.overlayUrl}
                    maxNativeZoom={style.maxNativeZoom}
                    maxZoom={20}
                    minZoom={2}
                    noWrap
                />
            )}
        </>
    );
};

const MAP_ERROR =
    "Couldn't update the map: the answers may contradict each other, or map data failed to load.";

/**
 * Drawing tools: the host can draw a custom play area; anyone can draw while
 * editing a custom question's zone or points.
 */
function DrawTools() {
    const session = useStore(gameSession);
    const host = useStore(isHost);
    const drawingKey = useStore(drawingQuestionKey);
    if (session && !host && drawingKey === -1) return null;
    return <PolygonDraw />;
}

/** Padding that keeps fitted areas clear of the top bar, sheet and side panel. */
const fitPadding = (): L.FitBoundsOptions => {
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    return desktop
        ? { paddingTopLeft: [424, 80], paddingBottomRight: [72, 24] }
        : { paddingTopLeft: [16, 80], paddingBottomRight: [16, 168] };
};

export const Map = ({ className }: { className?: string }) => {
    const $additionalMapGeoLocations = useStore(additionalMapGeoLocations);
    const $mapGeoLocation = useStore(mapGeoLocation);
    const $polyGeoJSON = useStore(polyGeoJSON);
    const $questions = useStore(questions);
    const $baseTileLayer = useStore(baseTileLayer);
    const $thunderforestApiKey = useStore(thunderforestApiKey);
    const $hiderMode = useStore(hiderMode);
    const $session = useStore(gameSession);
    const $syncReady = useStore(syncReady);
    // In a game, wait until the host's area is applied before computing.
    const canCompute = $session === null || $syncReady;
    useStore(isLoading);
    const $followMe = useStore(followMe);
    const $permanentOverlay = useStore(permanentOverlay);
    const map = useStore(leafletMapContext);

    const followMeMarkerRef = useMemo(
        () => ({ current: null as L.Marker | null }),
        [],
    );
    const geoWatchIdRef = useMemo(
        () => ({ current: null as number | null }),
        [],
    );

    const refreshQuestions = async (focus: boolean = false) => {
        if (!map) return;

        isLoading.set(true);

        let result;
        try {
            result = await computeMapAsync({
                questions: questionsForMap(
                    $questions,
                    planningModeEnabled.get(),
                ),
                env: snapshotGeoEnv(),
                planningModeEnabled: planningModeEnabled.get(),
            });
        } catch (error) {
            if (error instanceof ComputeCancelled) return; // a newer refresh owns the spinner
            console.log(error);
            isLoading.set(false);
            toast.error(MAP_ERROR, { toastId: "map-error" });
            return;
        }

        try {
            if (result.baseMapGeoJSON && !mapGeoJSON.get()) {
                mapGeoJSON.set(result.baseMapGeoJSON);
            }

            if (result.hiderifiedQuestions) {
                const byKey = new globalThis.Map(
                    result.hiderifiedQuestions.map((q) => [q.key, q.data]),
                );
                for (const question of $questions) {
                    if (byKey.has(question.key)) {
                        question.data = byKey.get(question.key) as any;
                    }
                }
                triggerLocalRefresh.set(Math.random()); // Refresh the question sidebar with new information but not this map
            }

            for (const [, layer] of questionLayers) {
                map.removeLayer(layer);
            }
            questionLayers.clear();
            for (const { key, polygon } of result.planningPolygons) {
                const geoJSONPlane = L.geoJSON(polygon as any);
                geoJSONPlane.addTo(map);
                questionLayers.set(key, geoJSONPlane);
            }

            if (eliminationLayer) {
                map.removeLayer(eliminationLayer);
                eliminationLayer = null;
            }

            const g = L.geoJSON(result.eliminationMask as any);
            eliminationLayer = g;
            g.addTo(map);

            questionFinishedMapData.set(result.eliminationMask);

            if (autoZoom.get() && focus && result.bbox) {
                const bbox = result.bbox;
                const bounds = [
                    [bbox[1], bbox[0]],
                    [bbox[3], bbox[2]],
                ];

                if (animateMapMovements.get()) {
                    map.flyToBounds(bounds as any, fitPadding());
                } else {
                    map.fitBounds(bounds as any, fitPadding());
                }
            }
        } catch (error) {
            console.log(error);
            toast.error(MAP_ERROR, { toastId: "map-error" });
        } finally {
            isLoading.set(false);
        }
    };

    const displayMap = useMemo(
        () => (
            <MapContainer
                center={$mapGeoLocation.geometry.coordinates}
                zoom={5}
                zoomControl={false}
                className={cn("h-full w-full", className)}
                preferCanvas={true}
                ref={leafletMapContext.set}
                // @ts-expect-error Typing doesn't update from react-contextmenu
                contextmenu={true}
                contextmenuWidth={140}
                contextmenuItems={[
                    {
                        text: "Add Radius",
                        callback: (e: any) =>
                            addQuestion({
                                id: "radius",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            }),
                    },
                    {
                        text: "Add Thermometer",
                        callback: (e: any) => {
                            const destination = turf.destination(
                                [e.latlng.lng, e.latlng.lat],
                                5,
                                90,
                                {
                                    units: "miles",
                                },
                            );

                            addQuestion({
                                id: "thermometer",
                                data: {
                                    latA: e.latlng.lat,
                                    lngA: e.latlng.lng,
                                    latB: destination.geometry.coordinates[1],
                                    lngB: destination.geometry.coordinates[0],
                                },
                            });
                        },
                    },
                    {
                        text: "Add Tentacles",
                        callback: (e: any) => {
                            addQuestion({
                                id: "tentacles",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            });
                        },
                    },
                    {
                        text: "Add Matching",
                        callback: (e: any) => {
                            addQuestion({
                                id: "matching",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            });
                        },
                    },
                    {
                        text: "Add Measuring",
                        callback: (e: any) => {
                            addQuestion({
                                id: "measuring",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                },
                            });
                        },
                    },
                    {
                        text: "Exclude Country",
                        callback: (e: any) => {
                            addQuestion({
                                id: "matching",
                                data: {
                                    lat: e.latlng.lat,
                                    lng: e.latlng.lng,
                                    same: false,
                                    cat: {
                                        adminLevel: 2,
                                    },
                                    type: "zone",
                                },
                            });
                        },
                    },
                    {
                        text: "Copy Coordinates",
                        callback: (e: any) => {
                            if (!navigator || !navigator.clipboard) {
                                toast.error(
                                    "Clipboard API not supported in your browser",
                                );
                                return;
                            }

                            const latitude = e.latlng.lat;
                            const longitude = e.latlng.lng;

                            toast.promise(
                                navigator.clipboard.writeText(
                                    `${Math.abs(latitude)}°${latitude > 0 ? "N" : "S"}, ${Math.abs(
                                        longitude,
                                    )}°${longitude > 0 ? "E" : "W"}`,
                                ),
                                {
                                    pending: "Writing to clipboard...",
                                    success: "Coordinates copied!",
                                    error: "An error occurred while copying",
                                },
                                { autoClose: 1000 },
                            );
                        },
                    },
                ]}
            >
                {getTileLayer($baseTileLayer, $thunderforestApiKey)}
                <DraggableMarkers />
                <ZoomControl position="topright" />
                <DrawTools />
                <ScaleControl position="bottomleft" />
            </MapContainer>
        ),
        [map, $baseTileLayer, $thunderforestApiKey],
    );

    // Jump to a newly chosen play area right away (its search result carries a
    // bounding box), instead of waiting for the full border to download.
    const lastArea = useRef<string | null>(null);
    useEffect(() => {
        if (!map || $polyGeoJSON) return;
        const props = $mapGeoLocation?.properties;
        const id = `${props?.osm_type}${props?.osm_id}`;
        if (lastArea.current === id) return;
        lastArea.current = id;
        const e = props?.extent;
        if (Array.isArray(e) && e.length === 4) {
            map.fitBounds(
                [
                    [e[0], e[1]],
                    [e[2], e[3]],
                ],
                fitPadding(),
            );
        } else if ($mapGeoLocation?.geometry?.coordinates) {
            map.setView($mapGeoLocation.geometry.coordinates as any, 10);
        }
    }, [map, $mapGeoLocation, $polyGeoJSON]);

    // Debounce to batch rapid changes (e.g. marker dragging).
    useEffect(() => {
        if (!map || !canCompute) return;
        const timeout = setTimeout(() => refreshQuestions(true), 150);
        return () => clearTimeout(timeout);
    }, [
        $questions,
        map,
        $hiderMode,
        canCompute,
        $mapGeoLocation,
        $polyGeoJSON,
        $additionalMapGeoLocations,
    ]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const mainElement: HTMLElement | null =
                document.querySelector("main");

            if (mainElement) {
                if (document.fullscreenElement) {
                    mainElement.classList.add("fullscreen");
                } else {
                    mainElement.classList.remove("fullscreen");
                }
            }
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            document.removeEventListener(
                "fullscreenchange",
                handleFullscreenChange,
            );
        };
    }, []);

    useEffect(() => {
        if (!map) return;
        if (!$followMe) {
            if (followMeMarkerRef.current) {
                map.removeLayer(followMeMarkerRef.current);
                followMeMarkerRef.current = null;
            }
            if (geoWatchIdRef.current !== null) {
                navigator.geolocation.clearWatch(geoWatchIdRef.current);
                geoWatchIdRef.current = null;
            }
            return;
        }

        geoWatchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (followMeMarkerRef.current) {
                    followMeMarkerRef.current.setLatLng([lat, lng]);
                } else {
                    const marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            html: `<div class="text-blue-700 bg-white rounded-full border-2 border-blue-700 shadow w-5 h-5 flex items-center justify-center"><svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#2A81CB" opacity="0.5"/><circle cx="8" cy="8" r="3" fill="#2A81CB"/></svg></div>`,
                            className: "",
                        }),
                        zIndexOffset: 1000,
                    });
                    marker.addTo(map);
                    followMeMarkerRef.current = marker;
                }
            },
            () => {
                toast.error("Unable to access your location.");
                followMe.set(false);
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
        );
        return () => {
            if (followMeMarkerRef.current) {
                map.removeLayer(followMeMarkerRef.current);
                followMeMarkerRef.current = null;
            }
            if (geoWatchIdRef.current !== null) {
                navigator.geolocation.clearWatch(geoWatchIdRef.current);
                geoWatchIdRef.current = null;
            }
        };
    }, [$followMe, map]);

    useEffect(() => {
        if (!map) return;

        map.eachLayer((layer: any) => {
            if (layer.permanentGeoJSON) map.removeLayer(layer);
        });

        if ($permanentOverlay === null) return;

        try {
            const overlay = L.geoJSON($permanentOverlay, {
                interactive: false,

                // @ts-expect-error Type hints force a Layer to be returned, but Leaflet accepts null as well
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                pointToLayer(geoJsonPoint, latlng) {
                    return null;
                },

                style(feature) {
                    return {
                        color: feature?.properties?.stroke,
                        weight: feature?.properties?.["stroke-width"],
                        opacity: feature?.properties?.["stroke-opacity"],
                        fillColor: feature?.properties?.fill,
                        fillOpacity: feature?.properties?.["fill-opacity"],
                    };
                },
            });
            // @ts-expect-error This is a check such that only this type of layer is removed
            overlay.permanentGeoJSON = true;
            overlay.addTo(map);
            overlay.bringToBack();
        } catch (e) {
            toast.error(`Failed to display GeoJSON overlay: ${e}`);
        }
    }, [$permanentOverlay, map]);

    return displayMap;
};
