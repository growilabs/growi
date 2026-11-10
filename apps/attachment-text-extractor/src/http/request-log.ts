import type { LogLevel } from '../config/load-settings';

// One line per POST /extract (Req 1.7), in the target spec's form:
// "extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…".
// Never the file name, the content or the Authorization header: the format
// is the cleaned extension only.

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  CRITICAL: 50,
  FATAL: 50,
  ERROR: 40,
  WARN: 30,
  WARNING: 30,
  INFO: 20,
  DEBUG: 10,
  NOTSET: 0,
};

type Written = 'INFO' | 'ERROR';

export interface RequestFacts {
  /** The cleaned extension (formatOf), or the converted mimeType. */
  readonly format?: string;
  readonly size?: number;
  readonly childPeakRssMb?: number | null;
}

/** Writes the line of one request, timed from its start. */
export type RequestLine = (result: string, facts?: RequestFacts) => void;

export interface RequestLog {
  start(): RequestLine;
  error(message: string): void;
}

/** The extension only, lower-cased, letters and digits, at most 10 (Python's _format_of). */
export const formatOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  const suffix = dot === -1 ? '' : fileName.slice(dot + 1);
  return (
    suffix
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 10) || 'unknown'
  );
};

export const writeToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

export const createRequestLog = (
  level: LogLevel,
  writeLog: (line: string) => void,
): RequestLog => {
  const emit = (severity: Written, message: string): void => {
    if (SEVERITY[severity] < SEVERITY[level]) return;
    writeLog(`${new Date().toISOString()} ${severity} ${message}`);
  };
  return {
    start: () => {
      const started = performance.now();
      return (result, { format, size, childPeakRssMb } = {}) => {
        const durationMs = Math.round(performance.now() - started);
        emit(
          'INFO',
          `extract format=${format ?? 'unknown'} size=${size ?? 0} duration_ms=${durationMs} result=${result} child_peak_rss_mb=${childPeakRssMb ?? 'unknown'}`,
        );
      };
    },
    error: (message) => emit('ERROR', message),
  };
};
