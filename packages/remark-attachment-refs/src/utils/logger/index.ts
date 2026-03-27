import type { Logger } from '@growi/logger';
import { initializeLoggerFactory, loggerFactory } from '@growi/logger';

initializeLoggerFactory({ config: { default: 'info' } });

export type { Logger };
export default loggerFactory;
