import type { Logger } from '@growi/logger';
import { initializeLoggerFactory, loggerFactory } from '@growi/logger';

import configForDev from '~/config/logger/config.dev';
import configForProd from '~/config/logger/config.prod';

const isProduction = process.env.NODE_ENV === 'production';
const config = isProduction ? configForProd : configForDev;

initializeLoggerFactory({ config });

export type { Logger };
export default loggerFactory;
