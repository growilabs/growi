import type Crowi from '~/server/crowi/index.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:service:s2s-messaging:redis');

export const setup = (crowi: Crowi) => {
  logger.warn('Config pub/sub with Redis has not implemented yet.');
};
