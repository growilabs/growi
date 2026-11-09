import type { ConversionLimits } from '../contract';

const LOG_LEVELS = [
  'CRITICAL',
  'FATAL',
  'ERROR',
  'WARN',
  'WARNING',
  'INFO',
  'DEBUG',
  'NOTSET',
] as const;

/** Python logging level names; request-log maps them to its own levels. */
export type LogLevel = (typeof LOG_LEVELS)[number];

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

type Env = Readonly<Record<string, string | undefined>>;

const MIB = 1024 * 1024;
const TOKEN_NAME = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';
const INTEGER_PATTERN = /^[+-]?\d+$/;

const readToken = (env: Env): string => {
  const token = env[TOKEN_NAME];
  if (token == null || token.trim() === '') {
    throw new Error(`${TOKEN_NAME} must be set to a non-empty value`);
  }
  return token;
};

const readInteger = (
  env: Env,
  name: string,
  defaultValue: number,
  { positive = false }: { positive?: boolean } = {},
): number => {
  const raw = env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const text = raw.trim();
  const value = Number(text);
  if (!INTEGER_PATTERN.test(text) || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  if (positive && value <= 0) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
};

const readLogLevel = (env: Env): LogLevel => {
  const raw = env.LOG_LEVEL;
  if (raw === undefined) {
    return 'INFO';
  }
  const name = raw.trim().toUpperCase();
  const level = LOG_LEVELS.find((candidate) => candidate === name);
  if (level === undefined) {
    throw new Error(
      `LOG_LEVEL must be a logging level name, got ${JSON.stringify(raw)}`,
    );
  }
  return level;
};

/** Reads only the given env object, by upper-case names; never process.env or a .env file. */
export const loadSettings = (env: Env): Settings => ({
  serviceToken: readToken(env),
  maxFileSizeMb: readInteger(env, 'MAX_FILE_SIZE_MB', 50),
  timeoutS: readInteger(env, 'TIMEOUT_S', 55),
  uploadTimeoutS: readInteger(env, 'UPLOAD_TIMEOUT_S', 15, { positive: true }),
  maxConcurrency: readInteger(env, 'MAX_CONCURRENCY', 3),
  maxChildRssMb: readInteger(env, 'MAX_CHILD_RSS_MB', 320),
  maxXlsxCells: readInteger(env, 'MAX_XLSX_CELLS', 70_000),
  maxResultBytes: readInteger(env, 'MAX_RESULT_BYTES', 16 * MIB),
  maxPdfPages: readInteger(env, 'MAX_PDF_PAGES', 5_000),
  maxArchiveEntries: readInteger(env, 'MAX_ARCHIVE_ENTRIES', 10_000),
  maxArchiveUncompressedMb: readInteger(
    env,
    'MAX_ARCHIVE_UNCOMPRESSED_MB',
    512,
  ),
  maxCsvBytes: readInteger(env, 'MAX_CSV_BYTES', 8 * MIB, { positive: true }),
  maxHtmlBytes: readInteger(env, 'MAX_HTML_BYTES', 20 * MIB, {
    positive: true,
  }),
  logLevel: readLogLevel(env),
});

export const toConversionLimits = (settings: Settings): ConversionLimits => ({
  maxXlsxCells: settings.maxXlsxCells,
  maxPdfPages: settings.maxPdfPages,
  maxArchiveEntries: settings.maxArchiveEntries,
  maxArchiveUncompressedBytes: settings.maxArchiveUncompressedMb * MIB,
  maxResultBytes: settings.maxResultBytes,
  maxCsvBytes: settings.maxCsvBytes,
  maxHtmlBytes: settings.maxHtmlBytes,
});
