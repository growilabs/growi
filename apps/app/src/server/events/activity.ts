import events from 'node:events';
import util from 'node:util';

import type Crowi from '../crowi';

function ActivityEvent(crowi: Crowi) {
  this.crowi = crowi;

  events.EventEmitter.call(this);
}
util.inherits(ActivityEvent, events.EventEmitter);

export default ActivityEvent;
