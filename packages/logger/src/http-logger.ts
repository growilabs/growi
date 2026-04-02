import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp, {
  type HttpLogger,
  type Options as PinoHttpOptions,
} from 'pino-http';

import { loggerFactory } from './logger-factory';

interface HttpLoggerOptions {
  /** Logger namespace, defaults to 'express' */
  namespace?: string;
  /** Auto-logging configuration (e.g., route ignore patterns) */
  autoLogging?: {
    ignore: (req: { url?: string }) => boolean;
  };
}

/**
 * Create Express middleware for HTTP request logging.
 * In dev: uses pino-http with morgan-like formatting (dynamically imported).
 * In prod: uses pino-http with default formatting.
 *
 * The pino-http dependency is encapsulated here — consumer apps
 * should not import pino-http directly.
 */
export async function createHttpLoggerMiddleware(
  options?: HttpLoggerOptions,
): Promise<HttpLogger<IncomingMessage, ServerResponse>> {
  const namespace = options?.namespace ?? 'express';
  const logger = loggerFactory(namespace);

  const httpOptions: PinoHttpOptions = {
    // Logger<string> → pino-http's expected Logger type
    logger: logger as unknown as PinoHttpOptions['logger'],
    ...(options?.autoLogging != null
      ? { autoLogging: options.autoLogging }
      : {}),
  };

  // In development, dynamically import morgan-like format options
  if (process.env.NODE_ENV !== 'production') {
    const { morganLikeFormatOptions } = await import(
      './morgan-like-format-options'
    );
    Object.assign(httpOptions, morganLikeFormatOptions);
  }

  return pinoHttp(httpOptions);
}
