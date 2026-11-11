/// <reference lib="webworker" />
/**
 * Runs the question → eliminated-area pipeline off the main thread so the UI
 * never freezes while Turf / Voronoi / ArcGIS crunch geometry.
 */
import { ComputeCancelled, computeMap } from "@jetlag/geo/compute";
import {
    type ComputeRequest,
    countingNotifier,
} from "@jetlag/geo/compute-types";
import { setNotifier } from "@jetlag/geo/env";

import type { WorkerInbound, WorkerOutbound } from "./geo-protocol";

const post = (message: WorkerOutbound) =>
    (self as unknown as Worker).postMessage(message);

let latestId = 0;
let toastSeq = 0;

setNotifier(
    countingNotifier({
        error(message, options) {
            post({ type: "toast-error", message, toastId: options?.toastId });
        },
        promise(promise, messages) {
            if (!messages.pending) return promise;
            const toastKey = ++toastSeq;
            post({
                type: "toast-pending",
                toastKey,
                message: messages.pending,
            });
            promise
                .finally(() => post({ type: "toast-done", toastKey }))
                .catch(() => {});
            return promise;
        },
    }),
);

self.onmessage = async (event: MessageEvent<WorkerInbound>) => {
    const message = event.data;
    if (message.type !== "compute") return;
    const { id } = message;
    latestId = id;
    try {
        const result = await computeMap(
            message.request as ComputeRequest,
            () => latestId !== id,
        );
        post({ type: "result", id, result });
    } catch (error: any) {
        if (error instanceof ComputeCancelled) post({ type: "cancelled", id });
        else
            post({
                type: "error",
                id,
                message: String(error?.message ?? error),
            });
    }
};
