/** Typed client for the jetlag server (see packages/shared/src/api.ts). */
import type {
    CreateGameRequest,
    CreateQuestionRequest,
    ErrorCode,
    GameSessionResponse,
    GameState,
    GeoData,
    GeoField,
    JoinGameRequest,
    MutationResponse,
    UpdateSettingsRequest,
} from "@jetlag/shared";

export class ApiError extends Error {
    readonly status: number;
    readonly code: ErrorCode | "network";
    constructor(status: number, code: ErrorCode | "network", message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const BASE = "/api";

async function request<T>(
    method: string,
    path: string,
    body?: unknown,
): Promise<T> {
    let res: Response;
    try {
        res = await fetch(BASE + path, {
            method,
            credentials: "same-origin",
            headers: {
                ...(method !== "GET" ? { "X-Requested-With": "jetlag" } : {}),
                ...(body !== undefined
                    ? { "Content-Type": "application/json" }
                    : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new ApiError(
            0,
            "network",
            "Can't reach the server. Check your connection.",
        );
    }
    if (res.status === 204) return undefined as T;
    let json: any = null;
    try {
        json = await res.json();
    } catch {
        /* non-JSON error page (e.g. proxy) */
    }
    if (!res.ok) {
        throw new ApiError(
            res.status,
            json?.error?.code ?? "internal",
            json?.error?.message ?? `Request failed (${res.status})`,
        );
    }
    return json as T;
}

const enc = encodeURIComponent;

export const api = {
    createGame: (body: CreateGameRequest) =>
        request<GameSessionResponse>("POST", "/games", body),
    joinGame: (body: JoinGameRequest) =>
        request<GameSessionResponse>("POST", "/games/join", body),
    rejoin: (roomCode: string) =>
        request<GameSessionResponse>("GET", `/games/by-code/${enc(roomCode)}`),
    state: (gameId: string) =>
        request<GameState>("GET", `/games/${enc(gameId)}/state`),
    geo: (gameId: string) =>
        request<GeoData>("GET", `/games/${enc(gameId)}/geo`),
    geoField: (gameId: string, field: GeoField) =>
        request<{ value: unknown }>(
            "GET",
            `/games/${enc(gameId)}/geo/${field}`,
        ),
    leave: (gameId: string) =>
        request<void>("POST", `/games/${enc(gameId)}/leave`),
    start: (gameId: string) =>
        request<MutationResponse>("POST", `/games/${enc(gameId)}/start`),
    end: (gameId: string) =>
        request<MutationResponse>("POST", `/games/${enc(gameId)}/end`),
    updateSettings: (gameId: string, body: UpdateSettingsRequest) =>
        request<MutationResponse>(
            "PATCH",
            `/games/${enc(gameId)}/settings`,
            body,
        ),
    putGeo: (gameId: string, field: GeoField, value: unknown) =>
        request<MutationResponse>("PUT", `/games/${enc(gameId)}/geo/${field}`, {
            value,
        }),
    putHiderLocation: (gameId: string, lat: number, lng: number) =>
        request<MutationResponse>(
            "PUT",
            `/games/${enc(gameId)}/hider-location`,
            { lat, lng },
        ),
    askQuestion: (gameId: string, body: CreateQuestionRequest) =>
        request<MutationResponse>(
            "POST",
            `/games/${enc(gameId)}/questions`,
            body,
        ),
    answer: (questionId: string, data: Record<string, unknown>) =>
        request<MutationResponse>(
            "POST",
            `/questions/${enc(questionId)}/answer`,
            { data },
        ),
    undoAnswer: (answerId: string) =>
        request<MutationResponse>("DELETE", `/answers/${enc(answerId)}`),
    veto: (questionId: string, reason: string | null) =>
        request<MutationResponse>(
            "POST",
            `/questions/${enc(questionId)}/veto`,
            { reason },
        ),
    unveto: (vetoId: string) =>
        request<MutationResponse>("DELETE", `/vetoes/${enc(vetoId)}`),
    eventsUrl: (gameId: string) => `${BASE}/games/${enc(gameId)}/events`,
};

export const createShare = (data: string) =>
    request<{ id: string }>("POST", "/shares", { data });
export const fetchShare = (id: string) =>
    request<{ data: string }>("GET", `/shares/${enc(id)}`);
