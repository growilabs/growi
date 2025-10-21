const events = require('events');
const util = require('util');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
function TagEvent(crowi) {
  this.crowi = crowi;

  events.EventEmitter.call(this);
}
util.inherits(TagEvent, events.EventEmitter);

TagEvent.prototype.onUpdate = (tag) => {};

module.exports = TagEvent;
