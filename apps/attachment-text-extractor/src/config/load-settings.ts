import type { ConversionLimits } from '../contract';

/** Python logging level names; request-log maps them to its own levels. */
export type LogLevel =
  | 'CRITICAL'
  | 'FATAL'
  | 'ERROR'
  | 'WARN'
  | 'WARNING'
  | 'INFO'
  | 'DEBUG'
  | 'NOTSET';

export interface Settings {
  readonly serviceToken: string;
  readonly maxFileSizeMb: number;
  readonly timeoutS: number;
  readonly uploadTimeoutS: number;
  readonly maxConcurrency: number;
  readonly maxChildRssMb: number;
  readonly maxXlsxCells: number;
  readonly maxResultBytes: number;
  readonly maxPdfPages: number;
  readonly maxArchiveEntries: number;
  readonly maxArchiveUncompressedMb: number;
  readonly maxCsvBytes: number;
  readonly maxHtmlBytes: number;
  readonly logLevel: LogLevel;
}

export const loadSettings = (
  _env: Readonly<Record<string, string | undefined>>,
): Settings => {
  throw new Error('not implemented: config/load-settings.loadSettings');
};

export const toConversionLimits = (_settings: Settings): ConversionLimits => {
  throw new Error('not implemented: config/load-settings.toConversionLimits');
};
