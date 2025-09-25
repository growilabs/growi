import type Logger from 'bunyan';
import { createLogger } from 'universal-bunyan';

const loggerFactory = (name: string): Logger =>
  createLogger({
    name,
    config: { default: 'info' },
  });

export default loggerFactory;
