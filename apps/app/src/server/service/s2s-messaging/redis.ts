import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';

const logger = loggerFactory('growi:service:s2s-messaging:redis');

export const setup = (crowi: Crowi) => {
  logger.warn('Config pub/sub with Redis has not implemented yet.');
};
