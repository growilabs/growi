import EventEmitter from 'events';

import type Crowi from '../crowi';

class UserEvent extends EventEmitter {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }
}

export default UserEvent;
