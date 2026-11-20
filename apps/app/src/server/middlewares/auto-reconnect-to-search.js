import loggerFactory from '~/utils/logger';

import {
  nextTick,
  ReconnectContext,
} from '../service/search-reconnect-context/reconnect-context';

const logger = loggerFactory('growi:middlewares:auto-reconnect-to-search');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
export const setup = (crowi) => {
  const { searchService } = crowi;
  const reconnectContext = new ReconnectContext();

  const reconnectHandler = async () => {
    try {
      logger.info('Auto reconnection is started.');
      await searchService.reconnectClient();
    } catch (err) {
      logger.error('Auto reconnection failed.', err);
    }

    return searchService.isReachable;
  };

  return (req, res, next) => {
    if (
      searchService != null &&
      searchService.isConfigured &&
      !searchService.isReachable
    ) {
      // NON-BLOCKING CALL
      // for the latency of the response
      nextTick(reconnectContext, reconnectHandler);
    }

    return next();
  };
};
