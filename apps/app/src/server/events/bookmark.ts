import EventEmitter from 'node:events';

import type Crowi from '../crowi/index.js';

class BookmarkEvent extends EventEmitter {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  onCreate(_bookmark: unknown): void {
    // placeholder for event handler
  }

  onDelete(_bookmark: unknown): void {
    // placeholder for event handler
  }
}

export default BookmarkEvent;
