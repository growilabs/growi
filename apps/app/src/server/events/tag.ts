import EventEmitter from 'node:events';
import type { ITag } from '@growi/core';

import type Crowi from '../crowi';

class TagEvent extends EventEmitter {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  onUpdate(_tag: ITag): void {
    // placeholder for event handler
  }
}

export default TagEvent;
