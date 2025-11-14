import type Logger from 'bunyan';
import { createLogger, type UniversalBunyanConfig } from 'universal-bunyan';

import configForDev from '^/config/logger/config.dev';
import configForProd from '^/config/logger/config.prod';

const isProduction = process.env.NODE_ENV === 'production';
const config = (
  isProduction ? configForProd : configForDev
) as UniversalBunyanConfig;

const loggerFactory = (name: string): Logger =>
  createLogger({
    name,
    config,
  });

export default loggerFactory;
