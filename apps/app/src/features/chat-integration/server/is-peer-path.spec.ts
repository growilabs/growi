import { CHAT_INTEGRATION_PEER_PREFIX } from './consts';
import { isChatIntegrationPeerPath } from './is-peer-path';

describe('isChatIntegrationPeerPath()', () => {
  describe('paths the router serves from the proxy-facing sub-tree', () => {
    // Express matches routes without `case sensitive routing`, so every one of
    // these reaches the same `/peer` router. A middleware exclusion that
    // recognised only the lower-case spelling would leave the others served
    // but unexcluded -- the whole point of sharing this matcher.
    it.each([
      CHAT_INTEGRATION_PEER_PREFIX,
      `${CHAT_INTEGRATION_PEER_PREFIX}/command`,
      `${CHAT_INTEGRATION_PEER_PREFIX}/notification`,
      CHAT_INTEGRATION_PEER_PREFIX.toUpperCase(),
      '/_API/V3/CHAT-INTEGRATION/PEER/COMMAND',
      '/_api/V3/Chat-Integration/Peer/Command',
      '/_Api/v3/chat-integration/pEeR/command',
      // A trailing slash on the bare prefix is still the sub-tree's own root.
      `${CHAT_INTEGRATION_PEER_PREFIX}/`,
    ])('matches %s', (path) => {
      expect(isChatIntegrationPeerPath(path)).toBe(true);
    });
  });

  describe('paths outside it', () => {
    // The match stops at a segment boundary: a sibling whose name merely
    // starts with the same characters keeps the app-wide sanitization and
    // session, in any casing.
    it.each([
      `${CHAT_INTEGRATION_PEER_PREFIX}ing`,
      `${CHAT_INTEGRATION_PEER_PREFIX}ing/oops`,
      '/_API/v3/Chat-Integration/PEERing/oops',
      '/_API/V3/CHAT-INTEGRATION/PEERING',
      // The admin-screen endpoints share the feature base path and must keep
      // the parsed body their validators rely on.
      '/_api/v3/chat-integration/settings',
      '/_API/V3/CHAT-INTEGRATION/SETTINGS',
      // The prefix has to be at the start, not merely somewhere in the path.
      `/prefixed${CHAT_INTEGRATION_PEER_PREFIX}/command`,
      '/_api/v3/pages',
      '/',
      '',
    ])('does not match %s', (path) => {
      expect(isChatIntegrationPeerPath(path)).toBe(false);
    });
  });

  it('is not stateful across calls', () => {
    // A shared RegExp instance would carry `lastIndex` between calls if it
    // ever gained the `g` flag; the same path must always answer the same way.
    const path = `${CHAT_INTEGRATION_PEER_PREFIX}/command`;

    expect(isChatIntegrationPeerPath(path)).toBe(true);
    expect(isChatIntegrationPeerPath(path)).toBe(true);
  });
});
