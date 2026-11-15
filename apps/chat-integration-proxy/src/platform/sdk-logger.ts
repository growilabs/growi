// The logger handed to the Chat SDK and its adapters in place of their default
// `ConsoleLogger`, which prints the objects it is given -- an HTTP client
// failure among them, with the request's credentials inside.
import type { Logger } from 'chat';

/** Where one line about a failure goes; `runtime/dependencies.ts` decides. */
export type SdkLogReport = (line: string) => void;

const isError = (value: unknown): value is Error => value instanceof Error;

/**
 * `name: message` of the error the SDK passed, either bare or as the `error`
 * field of its context object. Only those two strings: every other field --
 * the request, its headers, its body -- is what must not be printed.
 */
const errorSummaryOf = (args: readonly unknown[]): string | null => {
  for (const arg of args) {
    if (isError(arg)) return `${arg.name}: ${arg.message}`;
    if (arg != null && typeof arg === 'object' && 'error' in arg) {
      const { error } = arg;
      if (isError(error)) return `${error.name}: ${error.message}`;
    }
  }
  return null;
};

/**
 * A logger that writes nothing itself. With `report`, each error and warning
 * becomes one line to it -- the SDK's message plus the summary of the error it
 * carried; without, the logger is silent. Debug and info are always dropped:
 * the SDK logs raw webhook bodies at debug.
 */
export const createSdkLogger = (
  report?: SdkLogReport,
  prefix = 'chat-sdk',
): Logger => {
  const forward = (message: string, args: readonly unknown[]): void => {
    if (report == null) return;
    const summary = errorSummaryOf(args);
    report(
      summary == null
        ? `[${prefix}] ${message}`
        : `[${prefix}] ${message} (${summary})`,
    );
  };
  return {
    child: (childPrefix) => createSdkLogger(report, `${prefix}:${childPrefix}`),
    debug: () => undefined,
    info: () => undefined,
    warn: (message, ...args) => forward(message, args),
    error: (message, ...args) => forward(message, args),
  };
};
