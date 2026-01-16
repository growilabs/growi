const events = require('events');
const util = require('util');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
function BookmarkEvent(crowi) {
  this.crowi = crowi;

  events.EventEmitter.call(this);
}
util.inherits(BookmarkEvent, events.EventEmitter);

BookmarkEvent.prototype.onCreate = (bookmark) => {};
BookmarkEvent.prototype.onDelete = (bookmark) => {};

module.exports = BookmarkEvent;
