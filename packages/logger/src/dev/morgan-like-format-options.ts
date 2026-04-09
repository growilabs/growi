import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Morgan-like log message formatters for pino-http.
 *
 * Produces concise one-liner messages in the style of morgan's "combined" format:
 *   GET /page/path 200 - 12ms
 *
 * Usage with pino-http:
 *   pinoHttp({ ...morganLikeFormatOptions, logger })
 */

const NO_COLOR = Boolean(process.env.NO_COLOR);
const RESET = NO_COLOR ? '' : '\x1b[0m';
const DIM = NO_COLOR ? '' : '\x1b[2m';

function statusAnsi(status: number): string {
  if (NO_COLOR) return '';
  if (status >= 500) return '\x1b[31m'; // red
  if (status >= 400) return '\x1b[33m'; // yellow
  if (status >= 300) return '\x1b[36m'; // cyan
  return '\x1b[32m'; // green
}

type CustomSuccessMessage = (
  req: IncomingMessage,
  res: ServerResponse,
  responseTime: number,
) => string;

type CustomErrorMessage = (
  req: IncomingMessage,
  res: ServerResponse,
  error: Error,
) => string;

type LogLevel = 'info' | 'warn' | 'error';

type CustomLogLevel = (
  req: IncomingMessage,
  res: ServerResponse,
  error: Error | undefined,
) => LogLevel;

export const morganLikeFormatOptions: {
  customSuccessMessage: CustomSuccessMessage;
  customErrorMessage: CustomErrorMessage;
  customLogLevel: CustomLogLevel;
} = {
  customSuccessMessage: (req, res, responseTime) => {
    const sc = statusAnsi(res.statusCode);
    return `${req.method} ${RESET}${req.url} ${sc}${res.statusCode}${RESET} - ${DIM}${Math.round(responseTime)}ms${RESET}`;
  },

  customErrorMessage: (req, res, error) => {
    const sc = statusAnsi(res.statusCode);
    return `${req.method} ${RESET}${req.url} ${sc}${res.statusCode}${RESET} - ${error.message}`;
  },

  customLogLevel: (_req, res, error) => {
    if (error != null || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
};
