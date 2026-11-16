// The logger handed to the Chat SDK and its adapters in place of their default
// `ConsoleLogger`, which prints the objects it is given -- an HTTP client
// failure among them, with the request's credentials inside.
import type { Logger } from 'chat';

/** Where one line about a failure goes; `runtime/dependencies.ts` decides. */
export type SdkLogReport = (line: string) => void;

/** Longest failure text a line carries, so one bad value cannot flood a log. */
const MAX_SUMMARY_LENGTH = 500;

/** How many call sites of an error's stack a line carries. */
const MAX_STACK_FRAMES = 5;

const isError = (value: unknown): value is Error => value instanceof Error;

const oneLine = (text: string): string => {
  const flat = text.replace(/\s*[\r\n]+\s*/g, ' ');
  return flat.length > MAX_SUMMARY_LENGTH
    ? `${flat.slice(0, MAX_SUMMARY_LENGTH)}...`
    : flat;
};

/**
 * Only the `at ...` lines: a stack's other lines are the message again, which
 * the summary already carries.
 */
const callSitesOf = (error: Error): readonly string[] =>
  (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => line.trim());

const describeError = (error: Error): string =>
  [
    `(${oneLine(`${error.name}: ${error.message}`)})`,
    ...callSitesOf(error),
  ].join(' | ');

/**
 * The error the SDK passed -- bare, or as the `error` field of its context
 * object, either an `Error` or the string an adapter already made of one.
 * Only its name, message and call sites: every other field -- the request,
 * its headers, its body -- is what must not be printed.
 */
const errorDetailOf = (args: readonly unknown[]): string | null => {
  for (const arg of args) {
    if (isError(arg)) return describeError(arg);
    if (arg != null && typeof arg === 'object' && 'error' in arg) {
      const { error } = arg;
      if (isError(error)) return describeError(error);
      if (typeof error === 'string') return `(${oneLine(error)})`;
    }
  }
  return null;
};

const lineOf = (
  prefix: string,
  message: string,
  args: readonly unknown[],
): string => {
  const head = `[${prefix}] ${message}`;
  try {
    const detail = errorDetailOf(args);
    return detail == null ? head : `${head} ${detail}`;
  } catch {
    return head;
  }
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
    const line = lineOf(prefix, message, args);
    try {
      report(line);
    } catch {
      // The SDK logs from inside a promise's `.catch`; a throw here would end
      // the process as an unhandled rejection, which is worse than one lost line.
    }
  };
  return {
    child: (childPrefix) => createSdkLogger(report, `${prefix}:${childPrefix}`),
    debug: () => undefined,
    info: () => undefined,
    warn: (message, ...args) => forward(message, args),
    error: (message, ...args) => forward(message, args),
  };
};
