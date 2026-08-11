export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function stamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(message: string, extra?: unknown): void {
    if (!shouldLog("debug")) return;
    console.debug(`[${stamp()}] DEBUG ${message}`, extra ?? "");
  },
  info(message: string, extra?: unknown): void {
    if (!shouldLog("info")) return;
    console.log(`[${stamp()}] INFO  ${message}`, extra ?? "");
  },
  warn(message: string, extra?: unknown): void {
    if (!shouldLog("warn")) return;
    console.warn(`[${stamp()}] WARN  ${message}`, extra ?? "");
  },
  error(message: string, extra?: unknown): void {
    if (!shouldLog("error")) return;
    console.error(`[${stamp()}] ERROR ${message}`, extra ?? "");
  },
};
