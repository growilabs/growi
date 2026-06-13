import {
  initInstrumentation,
  setupAdditionalResourceAttributes,
  startOpenTelemetry,
} from '~/features/opentelemetry/server/index.js';
import loggerFactory from '~/utils/logger/index.js';
import { hasProcessFlag } from '~/utils/process-utils.js';

const logger = loggerFactory('growi');

/** **********************************
 *          Main Process
 ********************************** */
process.on('uncaughtException', (err?: Error) => {
  logger.error({ err }, 'Uncaught Exception');
});

process.on('unhandledRejection', (reason, p) => {
  logger.error({ reason, promise: p }, 'Unhandled Rejection');
});

async function main() {
  try {
    // Initialize OpenTelemetry
    await initInstrumentation();

    const Crowi = (await import('./crowi/index.js')).default;
    const growi = new Crowi();
    const server = await growi.start();

    // Start OpenTelemetry
    await setupAdditionalResourceAttributes();
    startOpenTelemetry();

    if (hasProcessFlag('ci')) {
      logger.info('"--ci" flag is detected. Exit process.');
      server.close(() => {
        process.exit();
      });
    }
  } catch (err) {
    // The shared logger writes through a pino Worker-thread transport, which is
    // asynchronous. The forced process.exit(1) below terminates the process
    // before that worker can flush, so a fatal startup error logged only via the
    // logger is silently lost (exactly how the cause of a failed boot vanished).
    // A synchronous console write is the one reliable channel for a last-gasp
    // message before a hard exit — this is a genuine exception to "log via pino",
    // not a way to dodge the rule.
    // biome-ignore lint/suspicious/noConsole: synchronous last-gasp before process.exit; the pino worker transport cannot flush in time
    console.error('Failed to start the server:', err);
    // Also log through pino for sinks that do capture it (e.g. production
    // raw-JSON mode, which has no worker transport and flushes synchronously).
    logger.error(err, 'An error occurred, unable to start the server');
    process.exit(1);
  }
}

main();
