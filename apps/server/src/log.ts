import type { Config } from "./config.ts";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

export interface Logger {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
    level: Config["logLevel"],
    silent = false,
): Logger {
    const min = LEVELS[level];
    const write =
        (lvl: Level) => (msg: string, fields?: Record<string, unknown>) => {
            if (silent || LEVELS[lvl] < min) return;
            const line = JSON.stringify({
                t: new Date().toISOString(),
                level: lvl,
                msg,
                ...fields,
            });
            if (LEVELS[lvl] >= LEVELS.warn) process.stderr.write(line + "\n");
            else process.stdout.write(line + "\n");
        };
    return {
        debug: write("debug"),
        info: write("info"),
        warn: write("warn"),
        error: write("error"),
    };
}
