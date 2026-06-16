import { type DiagLogger, diag } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:opentelemetry:diag');

class DiagLoggerPinoAdapter implements DiagLogger {
  private parseMessage(
    message: string,
    args: unknown[],
  ): [logMessage: string, data: object] {
    let logMessage = message;
    let data = {};

    // check whether the message is a JSON string
    try {
      const parsedMessage = JSON.parse(message);
      if (typeof parsedMessage === 'object' && parsedMessage !== null) {
        data = parsedMessage;
        // if parsed successfully, use 'message' property as log message
        logMessage =
          'message' in data && typeof data.message === 'string'
            ? data.message
            : message;
      }
    } catch (_e) {
      // do nothing if the message is not a JSON string
    }

    // merge additional data
    if (args.length > 0) {
      const argsData = (args as any).reduce((acc, arg) => {
        if (typeof arg === 'string') {
          try {
            const parsed = JSON.parse(arg);
            return { ...acc, ...parsed };
          } catch (_e) {
            return { ...acc, additionalInfo: arg };
          }
        }
        return { ...acc, ...arg };
      }, {});
      data = { ...data, ...argsData };
    }

    return [logMessage, data];
  }

  error(message: string, ...args): void {
    const [msg, data] = this.parseMessage(message, args);
    logger.error(data, msg);
  }

  warn(message: string, ...args): void {
    const [msg, data] = this.parseMessage(message, args);
    logger.warn(data, msg);
  }

  info(message: string, ...args): void {
    const [msg, data] = this.parseMessage(message, args);
    logger.info(data, msg);
  }

  debug(message: string, ...args): void {
    const [msg, data] = this.parseMessage(message, args);
    logger.debug(data, msg);
  }

  verbose(message: string, ...args): void {
    const [msg, data] = this.parseMessage(message, args);
    logger.trace(data, msg);
  }
}

export const initLogger = (): void => {
  // Enable global logger for OpenTelemetry
  diag.setLogger(new DiagLoggerPinoAdapter());
};
