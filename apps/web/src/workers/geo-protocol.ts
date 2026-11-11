import type { ComputeRequest, ComputeResult } from "@jetlag/geo/compute-types";

export type WorkerInbound = {
    type: "compute";
    id: number;
    request: ComputeRequest;
};

export type WorkerOutbound =
    | { type: "result"; id: number; result: ComputeResult }
    | { type: "cancelled"; id: number }
    | { type: "error"; id: number; message: string }
    | { type: "toast-error"; message: string; toastId?: string }
    | { type: "toast-pending"; toastKey: number; message: string }
    | { type: "toast-done"; toastKey: number };
