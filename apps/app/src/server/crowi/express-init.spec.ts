import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import express from 'express';
import expressSession from 'express-session';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import { CHAT_INTEGRATION_PEER_PREFIX } from '~/features/chat-integration/server/consts';
import { configManager } from '~/server/service/config-manager';
import { resolveFromRoot } from '~/server/util/project-dir-utils';

import type Crowi from '.';
import { setup } from './express-init';

/**
 * A body large enough to be split across multiple stream chunks. A short
 * string would arrive in a single chunk and would therefore pass even against
 * the (broken) string-concatenation approach Gen 1 uses, which corrupts
 * multi-byte characters exactly at a chunk boundary.
 */
const buildMultibyteJsonText = (): string => {
  const paragraph =
    'これは日本語を含む本文です。ページ 1 枚ぶんの大きさを想定しています。' +
    '絵文字も混ぜる 🐢 — サロゲートペアも塊の境目に来る可能性がある。';
  return JSON.stringify({
    body: paragraph.repeat(700),
    path: '/日本語/ページ',
  });
};

type ReceivedBody = Request['body'];
type ReceivedQuery = Request['query'];

type Received = {
  body?: ReceivedBody;
  query?: ReceivedQuery;
  hasSession?: boolean;
};

type Harness = {
  app: Express;
  received: Received;
  sessionStore: expressSession.MemoryStore;
};

const buildApp = (): Harness => {
  const crowi: Crowi = mockDeep<Crowi>({
    node_env: 'test',
    port: 3000,
    publicDir: resolveFromRoot('public'),
  });

  const sessionStore = new expressSession.MemoryStore();
  vi.spyOn(sessionStore, 'set');

  // Assigned after the mock is built: passing this through mockDeep's
  // overrides would leave the members omitted here as mock proxies, and
  // express-session rejects such values.
  // `saveUninitialized` / `rolling` mirror the production configuration
  // (`crowi/index.ts`): with them off, a request that never touches its
  // session writes nothing anyway, and a spec asserting "no session document
  // is written" would pass without the exclusion under test.
  crowi.sessionConfig = {
    secret: 'express-init-spec-secret',
    resave: false,
    saveUninitialized: true,
    rolling: true,
    store: sessionStore,
    cookie: { maxAge: 60000 },
    genid: () => randomUUID(),
  };

  const app = express();
  setup(crowi, app);

  const received: Received = {};
  const record = (req: Request, res: express.Response) => {
    received.body = req.body;
    received.query = req.query;
    // `in` rather than a property read: there is no @types/express-session in
    // this workspace, and the property is genuinely absent (not undefined)
    // when the session middleware was skipped.
    received.hasSession = 'session' in req && req.session != null;
    res.status(204).end();
  };

  // Stand-ins for the real endpoints. Every path the exclusions have to
  // distinguish gets one:
  //  - the proxy-facing sub-tree, both as the bare prefix and with a
  //    trailing segment,
  //  - an admin-screen endpoint sharing the feature base path,
  //  - a path whose name merely starts with the prefix's last segment
  //    (`/peering`), which must NOT be treated as proxy-facing.
  app.post(CHAT_INTEGRATION_PEER_PREFIX, record);
  app.post(`${CHAT_INTEGRATION_PEER_PREFIX}/notification`, record);
  app.post(`${CHAT_INTEGRATION_PEER_PREFIX}/command`, record);
  app.post('/_api/v3/chat-integration/settings', record);
  app.post(`${CHAT_INTEGRATION_PEER_PREFIX}ing/oops`, record);

  return { app, received, sessionStore };
};

describe('express-init setup()', () => {
  beforeAll(() => {
    // `certify-origin` reads the module-level config-manager singleton, which
    // throws unless configs have been loaded from env + DB.
    vi.spyOn(configManager, 'getConfig').mockReturnValue(undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe(`requests under ${CHAT_INTEGRATION_PEER_PREFIX}`, () => {
    it('delivers the request body to the route as the exact bytes that were sent', async () => {
      // Sent as text so that what goes on the wire is exactly its UTF-8 bytes
      // (superagent JSON-stringifies a Buffer argument).
      const sentText = buildMultibyteJsonText();
      const sentBytes = Buffer.from(sentText, 'utf8');
      const { app, received } = buildApp();

      await request(app)
        .post(`${CHAT_INTEGRATION_PEER_PREFIX}/notification`)
        .set('content-type', 'application/json')
        .send(sentText)
        .expect(204);

      expect(Buffer.isBuffer(received.body)).toBe(true);
      expect((received.body as Buffer).equals(sentBytes)).toBe(true);
    });

    it('delivers the exact bytes when the content type carries a charset parameter', async () => {
      const sentText = buildMultibyteJsonText();
      const sentBytes = Buffer.from(sentText, 'utf8');
      const { app, received } = buildApp();

      await request(app)
        .post(`${CHAT_INTEGRATION_PEER_PREFIX}/notification`)
        .set('content-type', 'application/json; charset=utf-8')
        .send(sentText)
        .expect(204);

      expect(Buffer.isBuffer(received.body)).toBe(true);
      expect((received.body as Buffer).equals(sentBytes)).toBe(true);
    });

    it('delivers the exact bytes when the path is spelled in another case, which the router accepts too', async () => {
      const sentText = buildMultibyteJsonText();
      const sentBytes = Buffer.from(sentText, 'utf8');
      const { app, received } = buildApp();

      await request(app)
        .post('/_API/V3/CHAT-INTEGRATION/PEER/COMMAND')
        .set('content-type', 'application/json')
        .send(sentText)
        .expect(204);

      expect(Buffer.isBuffer(received.body)).toBe(true);
      expect((received.body as Buffer).equals(sentBytes)).toBe(true);
    });

    it('does not fail the request when the content type is not JSON, and does not hand the route a Buffer', async () => {
      const { app, received } = buildApp();

      await request(app)
        .post(`${CHAT_INTEGRATION_PEER_PREFIX}/notification`)
        .set('content-type', 'text/plain')
        .send('これは JSON ではない')
        .expect(204);

      // The signature guard rejects a non-Buffer body before verification;
      // this spec only pins that the parsing chain itself stays intact.
      expect(Buffer.isBuffer(received.body)).toBe(false);
    });
  });

  describe('requests under the same feature base path but outside /peer', () => {
    it('delivers a JSON-parsed object to the route', async () => {
      const { app, received } = buildApp();

      await request(app)
        .post('/_api/v3/chat-integration/settings')
        .set('content-type', 'application/json')
        .send({ isEnabled: true, label: '日本語のラベル' })
        .expect(204);

      expect(Buffer.isBuffer(received.body)).toBe(false);
      expect(received.body).toEqual({
        isEnabled: true,
        label: '日本語のラベル',
      });
    });
  });

  // The app-wide mongo-sanitize walk treats a Buffer as a plain object and
  // enumerates one key per byte, and the app-wide session writes a document
  // per request (`saveUninitialized`). Neither is wanted for the
  // machine-to-machine proxy endpoints. Both exclusions must match the same
  // way `app.use(CHAT_INTEGRATION_PEER_PREFIX, ...)` does: on path segments,
  // so the bare prefix and anything below it are covered while a merely
  // similar-looking sibling (`/peering`) is not.
  describe('mongo-sanitize and session exclusions for the proxy-facing sub-tree', () => {
    // A `$`-prefixed query key is the observable trace of the sanitize walk:
    // it survives only where the walk did not run.
    const mongoOperatorQuery = '?%24ne=1&plain=2';

    describe.each([
      ['the bare prefix', CHAT_INTEGRATION_PEER_PREFIX],
      [
        'a path below the prefix',
        `${CHAT_INTEGRATION_PEER_PREFIX}/notification`,
      ],
      // Express routes without `case sensitive routing`, so these reach the
      // very same proxy-facing endpoints. The exclusions have to agree with
      // the router, or an anonymous caller can pick a casing that skips them
      // and still be served: the sanitize walk then runs over the raw body it
      // was built to stay away from, and `saveUninitialized` writes a session
      // document per request to an endpoint that needs no login at all.
      [
        'the bare prefix, upper-cased',
        CHAT_INTEGRATION_PEER_PREFIX.toUpperCase(),
      ],
      [
        'a path below the prefix, upper-cased',
        '/_API/V3/CHAT-INTEGRATION/PEER/COMMAND',
      ],
      [
        'a path below the prefix, mixed-cased',
        '/_api/V3/Chat-Integration/Peer/Command',
      ],
    ])('%s (%s)', (_label, path) => {
      it('leaves the request untouched by mongo-sanitize', async () => {
        const { app, received } = buildApp();

        await request(app)
          .post(`${path}${mongoOperatorQuery}`)
          .set('content-type', 'application/json')
          .send('{}')
          .expect(204);

        expect(received.query).toEqual({ $ne: '1', plain: '2' });
      });

      it('creates no session, writes nothing to the session store and returns no cookie', async () => {
        const { app, received, sessionStore } = buildApp();

        const response = await request(app)
          .post(path)
          .set('content-type', 'application/json')
          .send('{}')
          .expect(204);

        expect(received.hasSession).toBe(false);
        expect(sessionStore.set).not.toHaveBeenCalled();
        expect(response.headers['set-cookie']).toBeUndefined();
      });
    });

    describe.each([
      [
        'an admin-screen endpoint under the same base path',
        '/_api/v3/chat-integration/settings',
      ],
      [
        'a sibling path that merely starts with the same characters',
        `${CHAT_INTEGRATION_PEER_PREFIX}ing/oops`,
      ],
      // Case-insensitivity must not widen the match past a segment boundary.
      [
        'that same sibling path, mixed-cased',
        '/_API/v3/Chat-Integration/PEERing/oops',
      ],
    ])('%s (%s)', (_label, path) => {
      it('is still sanitized', async () => {
        const { app, received } = buildApp();

        await request(app)
          .post(`${path}${mongoOperatorQuery}`)
          .set('content-type', 'application/json')
          .send({})
          .expect(204);

        expect(received.query).toEqual({ plain: '2' });
      });

      it('still gets a session, a session-store write and a cookie', async () => {
        const { app, received, sessionStore } = buildApp();

        const response = await request(app)
          .post(path)
          .set('content-type', 'application/json')
          .send({})
          .expect(204);

        expect(received.hasSession).toBe(true);
        expect(sessionStore.set).toHaveBeenCalled();
        expect(response.headers['set-cookie']).toBeDefined();
      });
    });
  });
});
