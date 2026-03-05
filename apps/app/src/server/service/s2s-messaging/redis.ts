import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:s2s-messaging:redis');

module.exports = (crowi: Crowi) => {
  logger.warn('Config pub/sub with Redis has not implemented yet.');
};
