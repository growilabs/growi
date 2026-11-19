import { createLeveledLog } from '../config/leveled-log';
import type { LogLevel } from '../config/load-settings';
import type { ExtractResult } from './error-table';

// One line per POST /extract, in the target spec's form:
// "extract format=… size=… duration_ms=… result=… child_peak_rss_mb=… app=…".
// Never the file name, the content or the Authorization header: the format
// is the cleaned extension only.

export interface RequestFacts {
  /** The cleaned extension (formatOf). */
  readonly format?: string;
  readonly size?: number;
  readonly childPeakRssMb?: number | null;
}

/** Writes the line of one request, timed from its start. */
export type RequestLine = (result: ExtractResult, facts?: RequestFacts) => void;

/** Takes the result and duration of every line, whatever LOG_LEVEL leaves out. */
export type RecordResult = (
  result: ExtractResult,
  durationSeconds: number,
) => void;

export interface RequestLog {
  start(appLabel: string): RequestLine;
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

export const createRequestLog = (
  level: LogLevel,
  writeLog: (line: string) => void,
  recordResult: RecordResult,
): RequestLog => {
  const emit = createLeveledLog(level, writeLog);
  return {
    start: (appLabel) => {
      const started = performance.now();
      return (result, { format, size, childPeakRssMb } = {}) => {
        const durationMs = Math.round(performance.now() - started);
        recordResult(result, durationMs / 1000);
        emit(
          'INFO',
          `extract format=${format ?? 'unknown'} size=${size ?? 0} duration_ms=${durationMs} result=${result} child_peak_rss_mb=${childPeakRssMb ?? 'unknown'} app=${appLabel}`,
        );
      };
    },
    error: (message) => emit('ERROR', message),
  };
};
