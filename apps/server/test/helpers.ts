import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { type App, createApp } from "../src/app.ts";
import { type Config, DATA_MARKER, loadConfig } from "../src/config.ts";
import { createLogger } from "../src/log.ts";

export interface TestServer {
    app: App;
    url: string;
    dataDir: string;
    clock: { now: number; advance(ms: number): void };
    close(): Promise<void>;
}

export function tempDataDir(withMarker = true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jetlag-test-"));
    if (withMarker) fs.writeFileSync(path.join(dir, DATA_MARKER), "");
    return dir;
}

export async function startServer(
    overrides: Partial<Config> = {},
): Promise<TestServer> {
    const dataDir = overrides.dataDir ?? tempDataDir();
    const clock = {
        now: Date.UTC(2026, 0, 1),
        advance(ms: number) {
            this.now += ms;
        },
    };
    const config: Config = {
        ...loadConfig({}),
        dataDir,
        cookieSecure: false,
        port: 0,
        host: "127.0.0.1",
        ...overrides,
    };
    const app = createApp({
        config,
        now: () => clock.now,
        logger: createLogger("error", true),
    });
    await new Promise<void>((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = app.server.address() as AddressInfo;
    return {
        app,
        url: `http://127.0.0.1:${port}`,
        dataDir,
        clock,
        close: () => app.close(2000),
    };
}

/** A fake browser: keeps its own cookie jar. */
export class Browser {
    cookie = "";
    readonly base: string;
    constructor(base: string) {
        this.base = base;
    }

    async request(
        method: string,
        url: string,
        body?: unknown,
        headers: Record<string, string> = {},
    ) {
        const init: RequestInit = {
            method,
            headers: {
                ...(this.cookie ? { cookie: this.cookie } : {}),
                ...(method !== "GET" ? { "x-requested-with": "jetlag" } : {}),
                ...(body !== undefined
                    ? { "content-type": "application/json" }
                    : {}),
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        };
        const res = await fetch(this.base + url, init);
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];
        const text = await res.text();
        let json: any = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = text;
        }
        return { status: res.status, json, text, headers: res.headers };
    }

    get = (url: string) => this.request("GET", url);
    post = (url: string, body?: unknown) => this.request("POST", url, body);
    put = (url: string, body?: unknown) => this.request("PUT", url, body);
    patch = (url: string, body?: unknown) => this.request("PATCH", url, body);
    del = (url: string) => this.request("DELETE", url);
}
