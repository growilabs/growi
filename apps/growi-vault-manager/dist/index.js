import { $log } from '@tsed/common';
import { PlatformExpress } from '@tsed/platform-express';

import Server from './server.js';

function hasProcessFlag(flag) {
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
  } catch (error) {
    $log.error(error);
  }
}
bootstrap();
//# sourceMappingURL=index.js.map
