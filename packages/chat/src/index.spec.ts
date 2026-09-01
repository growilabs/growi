import { describe, expect, it } from 'vitest';

import { CHAT_PACKAGE_NAME } from './index';

// Non-behavioral scaffold test (task 1.1): proves the package's build/test
// pipeline resolves and runs the entry point. Replaced by real contract
// tests starting at task 2.x.
describe('@growi/chat package scaffold', () => {
  it('exposes a package identity constant from the entry point', () => {
    expect(CHAT_PACKAGE_NAME).toBe('@growi/chat');
  });
});
