import type { LogLevel } from './load-settings';

// The service's one log: "<ISO 8601 UTC time> <level> <message>" per line, on
// standard error, with the lines below LOG_LEVEL left out. The request lines
// (http/request-log.ts) and the runner's diagnostic lines both go through it.

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

export type Severity = 'INFO' | 'WARNING' | 'ERROR';

export type LeveledLog = (severity: Severity, message: string) => void;

export const writeToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

export const createLeveledLog =
  (level: LogLevel, writeLog: (line: string) => void): LeveledLog =>
  (severity, message) => {
    if (SEVERITY[severity] < SEVERITY[level]) return;
    writeLog(`${new Date().toISOString()} ${severity} ${message}`);
  };
