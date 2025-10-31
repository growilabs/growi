import events from 'events';
import util from 'util';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:events:page');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
function PageEvent(crowi) {
  this.crowi = crowi;

  events.EventEmitter.call(this);
}
util.inherits(PageEvent, events.EventEmitter);

PageEvent.prototype.onCreate = (page, user) => {
  logger.debug('onCreate event fired');
};
PageEvent.prototype.onUpdate = (page, user) => {
  logger.debug('onUpdate event fired');
};
PageEvent.prototype.onCreateMany = (pages, user) => {
  logger.debug('onCreateMany event fired');
};
PageEvent.prototype.onAddSeenUsers = (pages, user) => {
  logger.debug('onAddSeenUsers event fired');
};
module.exports = PageEvent;
