import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./log.ts";

const config = loadConfig();
const log = createLogger(config.logLevel);

let app: ReturnType<typeof createApp>;
try {
    app = createApp({ config, logger: log });
} catch (error) {
    log.error("startup failed", {
        err: String((error as Error)?.message ?? error),
    });
    process.exit(1);
}

app.server.listen(config.port, config.host, () => {
    log.info("listening", {
        port: config.port,
        host: config.host,
        dataDir: config.dataDir,
        staticDir: config.staticDir,
        version: config.version,
        rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
});

let stopping = false;
const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    const hardStop = setTimeout(() => {
        log.error("forced exit after timeout");
        process.exit(1);
    }, 20_000);
    hardStop.unref();
    app.close(10_000).then(
        () => {
            log.info("stopped");
            process.exit(0);
        },
        (error) => {
            log.error("shutdown error", { err: String(error) });
            process.exit(1);
        },
    );
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
