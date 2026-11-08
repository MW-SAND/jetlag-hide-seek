/**
 * Main-thread side of the geo engine: installs toast notifications and runs
 * map computations in a Web Worker (falling back to the main thread if the
 * worker can't start, e.g. in very old browsers).
 */
import {
    ComputeCancelled,
    type ComputeRequest,
    type ComputeResult,
    countingNotifier,
} from "@jetlag/geo/compute-types";
import { setNotifier } from "@jetlag/geo/env";
import { type Id, toast } from "react-toastify";

import type { WorkerInbound, WorkerOutbound } from "@/workers/geo-protocol";

setNotifier(
    countingNotifier({
        error: (message, options) => {
            toast.error(message, options);
        },
        promise: (promise, messages) =>
            messages.pending
                ? (toast.promise(promise, {
                      pending: messages.pending,
                  }) as typeof promise)
                : promise,
    }),
);

interface Pending {
    resolve(result: ComputeResult): void;
    reject(error: unknown): void;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 0;
const pending = new Map<number, Pending>();
const workerToasts = new Map<number, Id>();

function getWorker(): Worker | null {
    if (workerBroken || typeof Worker === "undefined") return null;
    if (worker) return worker;
    try {
        worker = new Worker(
            new URL("../workers/geo.worker.ts", import.meta.url),
            {
                type: "module",
                name: "geo",
            },
        );
    } catch (error) {
        console.warn(
            "Geo worker unavailable, computing on the main thread",
            error,
        );
        workerBroken = true;
        return null;
    }
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
        const message = event.data;
        switch (message.type) {
            case "toast-error":
                toast.error(message.message, { toastId: message.toastId });
                return;
            case "toast-pending":
                workerToasts.set(
                    message.toastKey,
                    toast.loading(message.message),
                );
                return;
            case "toast-done": {
                const id = workerToasts.get(message.toastKey);
                if (id !== undefined) toast.dismiss(id);
                workerToasts.delete(message.toastKey);
                return;
            }
        }
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.type === "result") entry.resolve(message.result);
        else if (message.type === "cancelled")
            entry.reject(new ComputeCancelled());
        else entry.reject(new Error(message.message));
    };
    worker.onerror = (event) => {
        // A load/parse failure: switch to the main thread for good.
        console.warn(
            "Geo worker failed, computing on the main thread",
            event.message,
        );
        event.preventDefault();
        workerBroken = true;
        worker?.terminate();
        worker = null;
        for (const [, entry] of pending) entry.reject(new WorkerUnavailable());
        pending.clear();
    };
    return worker;
}

class WorkerUnavailable extends Error {}

let mainThreadLatest = 0;

async function computeOnMainThread(
    request: ComputeRequest,
): Promise<ComputeResult> {
    const id = ++mainThreadLatest;
    const { computeMap } = await import("@jetlag/geo/compute");
    return computeMap(structuredClone(request), () => mainThreadLatest !== id);
}

/**
 * Compute the eliminated area. A newer call cancels older ones, which then
 * reject with `ComputeCancelled`.
 */
export async function computeMapAsync(
    request: ComputeRequest,
): Promise<ComputeResult> {
    const w = getWorker();
    if (!w) return computeOnMainThread(request);

    const id = ++nextId;
    for (const [otherId, entry] of pending) {
        // The worker will report these as cancelled; reject early for snappier UI.
        if (otherId < id) {
            entry.reject(new ComputeCancelled());
            pending.delete(otherId);
        }
    }
    try {
        return await new Promise<ComputeResult>((resolve, reject) => {
            pending.set(id, { resolve, reject });
            const message: WorkerInbound = { type: "compute", id, request };
            w.postMessage(message);
        });
    } catch (error) {
        if (error instanceof WorkerUnavailable)
            return computeOnMainThread(request);
        throw error;
    }
}

export { ComputeCancelled };
