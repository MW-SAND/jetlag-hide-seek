/** Fixed-window, in-memory, per-key rate limiter with bounded memory. */
export interface RateRule {
    limit: number;
    windowMs: number;
}

export const RATE_RULES = {
    createGame: { limit: 20, windowMs: 10 * 60 * 1000 },
    joinGame: { limit: 60, windowMs: 10 * 60 * 1000 },
    share: { limit: 30, windowMs: 10 * 60 * 1000 },
    mutation: { limit: 600, windowMs: 60 * 1000 },
} satisfies Record<string, RateRule>;

export type RateBucket = keyof typeof RATE_RULES;

const MAX_KEYS = 20_000;

export function createRateLimiter(
    now: () => number,
    rules: Record<string, RateRule> = RATE_RULES,
) {
    const buckets = new Map<string, { count: number; resetAt: number }>();

    const prune = () => {
        const t = now();
        for (const [key, bucket] of buckets)
            if (bucket.resetAt <= t) buckets.delete(key);
        // Still too many (attack): drop the oldest half.
        if (buckets.size > MAX_KEYS) {
            let drop = buckets.size / 2;
            for (const key of buckets.keys()) {
                if (drop-- <= 0) break;
                buckets.delete(key);
            }
        }
    };

    return {
        /** Returns true when the request is allowed. */
        hit(bucket: string, ip: string): boolean {
            const rule = rules[bucket];
            if (!rule) return true;
            const key = `${bucket}:${ip}`;
            const t = now();
            let entry = buckets.get(key);
            if (!entry || entry.resetAt <= t) {
                if (buckets.size >= MAX_KEYS) prune();
                entry = { count: 0, resetAt: t + rule.windowMs };
                buckets.set(key, entry);
            }
            entry.count++;
            return entry.count <= rule.limit;
        },
        size: () => buckets.size,
        prune,
    };
}
