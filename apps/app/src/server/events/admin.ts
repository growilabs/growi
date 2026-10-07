import EventEmitter from 'node:events';

import type Crowi from '../crowi';

class AdminEvent extends EventEmitter {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }
}

export default AdminEvent;
