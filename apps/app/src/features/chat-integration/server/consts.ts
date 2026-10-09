/**
 * The URL prefix under which every request coming *from* the chat-integration
 * proxy (machine-to-machine, signature-verified) is served.
 *
 * This is deliberately narrower than the feature's own base path
 * (`/_api/v3/chat-integration`): the admin-screen endpoints live directly
 * under that base path and must keep the app-wide JSON body parsing (and the
 * input validators that depend on it). Only the `/peer` sub-tree receives the
 * raw request bytes, because verifying `content-digest` requires the exact
 * bytes as they arrived -- see the design's
 * "署名の検証には届いたバイト列そのものが要る" section.
 *
 * Referenced from `server/crowi/express-init.js` (raw body parsing) and from
 * the feature's own router registration, both of which mount it with
 * `app.use()`. Middleware that has to recognise such a request from its path
 * instead of mounting on it must go through `isChatIntegrationPeerPath()`
 * (`./is-peer-path`) rather than comparing against this constant itself.
 */
export const CHAT_INTEGRATION_PEER_PREFIX = '/_api/v3/chat-integration/peer';
