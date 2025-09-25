import { $log } from '@tsed/common';
import { PlatformExpress } from '@tsed/platform-express';

import { Server } from './Server';

function hasProcessFlag(flag: string): boolean {
  return process.argv.join('').indexOf(flag) > -1;
}

async function bootstrap() {
  try {
    $log.debug('Start server...');
    const platform = await PlatformExpress.bootstrap(Server);

    await platform.listen();
    $log.debug('Server initialized');

    if (hasProcessFlag('ci')) {
      $log.info('"--ci" flag is detected. Exit process.');
      process.exit();
    }
  } catch (er) {
    $log.error(er);
    process.exit(1);
  }
}

bootstrap();
