export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

const REDACTED_KEY = /(email|password|secret|token|verifier|authorization|cookie)/i;

function redact(value: unknown, key: string = '', seen: WeakSet<object> = new WeakSet()): unknown {
    if (REDACTED_KEY.test(key)) return '[redacted]';
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => redact(entry, '', seen));
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [entryKey, redact(entry, entryKey, seen)]));
}

export class StructuredLogger {
    constructor(private readonly component: string, private readonly baseContext: LogContext = {}) {}

    child(context: LogContext): StructuredLogger {
        return new StructuredLogger(this.component, { ...this.baseContext, ...context });
    }

    debug(event: string, context: LogContext = {}): void { this.write('debug', event, context); }
    sampledDebug(event: string, sampleKey: string, rate: number, context: LogContext = {}): void {
        const normalizedRate = Math.max(0, Math.min(1, rate));
        let hash = 2166136261;
        for (const character of `${event}:${sampleKey}`) {
            hash ^= character.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }
        if ((hash >>> 0) / 0x100000000 < normalizedRate) this.write('debug', event, context);
    }
    info(event: string, context: LogContext = {}): void { this.write('info', event, context); }
    warn(event: string, context: LogContext = {}): void { this.write('warn', event, context); }
    error(event: string, context: LogContext = {}): void { this.write('error', event, context); }

    private write(level: LogLevel, event: string, context: LogContext): void {
        const line = JSON.stringify(redact({ at: new Date().toISOString(), level, component: this.component, event, ...this.baseContext, ...context }));
        if (level === 'error') console.error(line);
        else if (level === 'warn') console.warn(line);
        else console.log(line);
    }
}
