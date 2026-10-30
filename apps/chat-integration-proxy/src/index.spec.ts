import { describe, expect, it } from 'vitest';

import { CHAT_INTEGRATION_PROXY_PACKAGE_NAME } from './index';

// Non-behavioral scaffold test (task 1.1): proves the app's build/test
// pipeline resolves and runs the entry point. Replaced by real component
// tests starting at task 1.3 onward.
describe('@growi/chat-integration-proxy app scaffold', () => {
  it('exposes a package identity constant from the entry point', () => {
    expect(CHAT_INTEGRATION_PROXY_PACKAGE_NAME).toBe(
      '@growi/chat-integration-proxy',
    );
  });
});
