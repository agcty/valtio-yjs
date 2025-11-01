import { LOG_PREFIX } from "./constants";

/**
 * Logger interface for valtio-y.
 * Provides debug, warn, and error logging with automatic prefix handling.
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Create a logger instance with optional debug and trace modes.
 *
 * @param debug - Enable debug logging (default: false)
 * @param trace - Enable trace logging (currently unused, reserved for future use)
 * @returns Logger instance that automatically prefixes all messages with [valtio-y]
 */
export function createLogger(
  debug: boolean = false,
  _trace: boolean = false,
): Logger {
  const withPrefix = (...args: unknown[]): unknown[] =>
    args.length > 0 && typeof args[0] === "string"
      ? [`${LOG_PREFIX} ${args[0] as string}`, ...(args.slice(1) as unknown[])]
      : [LOG_PREFIX, ...args];

  return {
    debug: (...args: unknown[]) => {
      if (!debug) return;
      console.debug(...(withPrefix(...args) as unknown[]));
    },
    warn: (...args: unknown[]) => {
      console.warn(...(withPrefix(...args) as unknown[]));
    },
    error: (...args: unknown[]) => {
      console.error(...(withPrefix(...args) as unknown[]));
    },
  };
}
