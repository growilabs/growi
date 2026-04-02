import { Writable } from 'node:stream';

interface BunyanFormatOptions {
  singleLine?: boolean;
  colorize?: boolean;
  destination?: NodeJS.WritableStream;
}

const LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

// ANSI color codes by level
const COLORS: Record<number, string> = {
  10: '\x1b[90m', // gray for TRACE
  20: '\x1b[36m', // cyan for DEBUG
  30: '\x1b[32m', // green for INFO
  40: '\x1b[33m', // yellow for WARN
  50: '\x1b[31m', // red for ERROR
  60: '\x1b[31m', // red for FATAL
};
const RESET = '\x1b[0m';

/**
 * Format a log object into bunyan-format "short" style:
 *   HH:mm:ss.SSSZ LEVEL name: message
 */
function formatLine(
  log: Record<string, unknown>,
  singleLine: boolean,
  colorize: boolean,
): string {
  const time = new Date(log.time as number).toISOString().slice(11);
  const level = log.level as number;
  const label = (LEVELS[level] ?? 'INFO').padStart(5);
  const name = (log.name as string) ?? '';
  const msg = (log.msg as string) ?? '';

  const color = colorize ? (COLORS[level] ?? '') : '';
  const reset = colorize ? RESET : '';

  let line = `${color}${time} ${label} ${name}:${reset} ${msg}`;

  // Extra fields (exclude standard pino fields)
  const extras: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(log)) {
    if (
      key !== 'level' &&
      key !== 'time' &&
      key !== 'msg' &&
      key !== 'name' &&
      key !== 'pid' &&
      key !== 'hostname'
    ) {
      extras[key] = val;
    }
  }

  if (Object.keys(extras).length > 0) {
    const extraStr = JSON.stringify(extras);
    if (singleLine) {
      line += ` ${extraStr}`;
    } else {
      line += `\n    ${extraStr}`;
    }
  }

  return `${line}\n`;
}

/**
 * Custom pino transport producing bunyan-format "short" mode output.
 * Format: HH:mm:ss.SSSZ LEVEL name: message
 *
 * Development only — this module is never imported in production.
 * Uses fs.writeSync(1, ...) to write directly to stdout fd, bypassing
 * thread-stream's stdout interception in Worker threads.
 */
// biome-ignore lint/style/noDefaultExport: pino transports require a default export for thread-stream Worker loading
export default (opts: BunyanFormatOptions) => {
  const singleLine = opts.singleLine ?? false;
  const colorize = opts.colorize ?? !process.env.NO_COLOR;
  const destination = opts.destination;

  const out = destination ?? process.stdout;

  return new Writable({
    write(chunk, _encoding, callback) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      // thread-stream may batch multiple JSON lines into one chunk
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        try {
          const log = JSON.parse(line);
          out.write(formatLine(log, singleLine, colorize));
        } catch {
          out.write(`${line}\n`);
        }
      }
      callback();
    },
  });
};
