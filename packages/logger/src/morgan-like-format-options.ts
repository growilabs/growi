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
    return `${req.method} ${req.url} ${res.statusCode} - ${Math.round(responseTime)}ms`;
  },

  customErrorMessage: (req, res, error) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${error.message}`;
  },

  customLogLevel: (_req, res, error) => {
    if (error != null || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
};
