import type Logger from 'bunyan';

import {
  initInstrumentation,
  setupAdditionalResourceAttributes,
  startOpenTelemetry,
} from '~/features/opentelemetry/server';
import loggerFactory from '~/utils/logger';
import { hasProcessFlag } from '~/utils/process-utils';

const logger: Logger = loggerFactory('growi');

/** **********************************
 *          Main Process
 ********************************** */
process.on('uncaughtException', (err?: Error) => {
  logger.error('Uncaught Exception: ', err);
});

process.on('unhandledRejection', (reason, p) => {
  logger.error('Unhandled Rejection: Promise:', p, 'Reason:', reason);
});

async function main() {
  try {
    // Initialize OpenTelemetry
    await initInstrumentation();

    const Crowi = (await import('./crowi')).default;
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
    logger.error('An error occurred, unable to start the server');
    logger.error(err);
    process.exit(1);
  }
}

main();
