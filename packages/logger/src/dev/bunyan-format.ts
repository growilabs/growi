import { Writable } from 'node:stream';
import { prettyFactory } from 'pino-pretty';

interface BunyanFormatOptions {
  singleLine?: boolean;
  colorize?: boolean;
  destination?: NodeJS.WritableStream;
}

const ANAI_COLORS = ['gray', 'green', 'yellow', 'red'] as const;

const LEVEL_SETTINGS: Record<
  number,
  { label: string; color: (typeof ANAI_COLORS)[number] }
> = {
  10: {
    label: 'TRACE',
    color: 'gray',
  },
  20: { label: 'DEBUG', color: 'gray' },
  30: { label: 'INFO', color: 'green' },
  40: { label: 'WARN', color: 'yellow' },
  50: { label: 'ERROR', color: 'red' },
  60: { label: 'FATAL', color: 'red' },
};

/**
 * Custom pino transport producing bunyan-format "short" mode output.
 * Format: HH:mm:ss.SSSZ LEVEL name: message
 *
 * Development only — this module is never imported in production.
 */
// biome-ignore lint/style/noDefaultExport: pino transports require a default export for thread-stream Worker loading
export default (opts: BunyanFormatOptions) => {
  const singleLine = opts.singleLine ?? false;
  const destination = opts.destination ?? process.stdout;

  const pretty = prettyFactory({
    colorize: opts.colorize ?? !process.env.NO_COLOR,
    ignore: 'pid,hostname,name,req,res,responseTime',
    translateTime: false,
    singleLine,
    // Suppress pino-pretty's default time and level rendering; we handle them in messageFormat
    customPrettifiers: { time: () => '', level: () => '' },
    messageFormat: (log, messageKey, _levelLabel, { colors }) => {
      const time = new Date(log.time as number).toISOString().slice(11);
      const levelNum = log.level as number;
      const label = LEVEL_SETTINGS[levelNum]?.label ?? 'INFO';
      const name = (log.name as string) ?? '';
      const msg = String(log[messageKey] ?? '');

      const padding = ' '.repeat(Math.max(0, 5 - label.length));
      const c = colors as unknown as Record<string, (s: string) => string>;
      const levelColor =
        c[LEVEL_SETTINGS[levelNum]?.color ?? 'reset'] ?? String;

      return `${c.gray(time)} ${levelColor(`${padding}${label}`)} ${c.white(`${name}:`)} ${msg}`;
    },
  });

  return new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try {
          destination.write(pretty(JSON.parse(line)) ?? '');
        } catch {
          destination.write(`${line}\n`);
        }
      }
      callback();
    },
  });
};
