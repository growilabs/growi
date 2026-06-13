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
    // Print synchronously to stderr first: pino's async transport can drop the
    // final log line when the process exits immediately afterwards, which would
    // otherwise make a fatal startup error vanish without a trace.
    console.error('Failed to start the server:', err);
    logger.error('An error occurred, unable to start the server');
    logger.error(err);
    process.exit(1);
  }
}

main();
