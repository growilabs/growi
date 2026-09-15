import { describe, expect, it } from 'vitest';

import * as commandLayer from './index.js';

describe('command/ public entry point', () => {
  it('exposes exactly the four modules orchestration needs, and nothing more', () => {
    // Asserted rather than described in a comment, for the same reason
    // `platform/index.spec.ts` asserts its own list: a barrel silently grows
    // when someone adds `export *`, and this layer's contract is the one thing
    // every later layer reads it through.
    expect(Object.keys(commandLayer).sort()).toEqual(
      [
        'ADMIN_COMMAND_WORDS',
        'COMMAND_TRAITS',
        'CommandInvocation',
        'LINK_COMMAND_WORD',
        'LINK_TRAIT',
        'PENDING_COLLECTION_TTL_MS',
        'SEARCH_DEFAULT_LIMIT',
        'createArgumentCollector',
        'isWorkspaceAdmin',
        'parseAdminCommand',
        'stripAddressToken',
      ].sort(),
    );
  });
});
