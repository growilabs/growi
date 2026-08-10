import { Cookie, MemoryStore } from 'express-session';
import { ObjectId } from 'mongodb';

import {
  canSelectSessions,
  invalidateSessionsExcept,
  resolveSessionAccess,
} from './g2g-transfer-session-invalidation';

type ErrorCallback = (err: unknown) => void;
type SessionCallback = (err: unknown, session?: unknown) => void;
type SessionsCallback = (err: unknown, sessions?: unknown) => void;

/**
 * A collection the invalidation can select documents in and delete them by id.
 * Only the two operations the destroy side needs are relevant here.
 */
const buildSessionsCollection = () => ({
  find: vi.fn(),
  deleteMany: vi.fn(),
});

/**
 * `connect-mongo`'s `MongoStore`, reduced to what the resolution can observe.
 *
 * `all()` deliberately answers the way the real one does — `unserialize(session.session)`
 * for every stored document, with no session id anywhere in the result
 * (`connect-mongo/build/main/lib/MongoStore.js`, `all`). A destination that took "the
 * store has `all()`" for "sessions can be selected" would claim support here and then
 * destroy nothing, because `destroy(sid)` needs an id this answer never carries.
 *
 * `collectionP` is the store's own promise of the MongoDB collection it reads and writes
 * (declared public in `connect-mongo`'s `MongoStore.d.ts`).
 */
const buildConnectMongoStore = (
  collectionP: PromiseLike<unknown> | undefined,
) => ({
  get: vi.fn(),
  set: vi.fn(),
  destroy: vi.fn(),
  all: vi.fn((callback: (err: unknown, sessions: unknown[]) => void) =>
    callback(null, [{ passport: { user: 'user-1' } }]),
  ),
  ...(collectionP == null ? {} : { collectionP }),
});

/**
 * `connect-redis`'s `RedisStore`, reduced the same way. Its `all()` strips `prefix` off
 * every key it scanned and puts the remainder on the session as `id`
 * (`connect-redis/lib/connect-redis.js`), which is what makes "destroy everything except
 * these users' sessions" expressible through the store API alone.
 */
const buildConnectRedisStore = () => ({
  get: vi.fn(),
  set: vi.fn(),
  destroy: vi.fn(),
  prefix: 'sess:',
  client: { mget: vi.fn() },
  all: vi.fn((callback: (err: unknown, sessions: unknown[]) => void) =>
    callback(null, [{ id: 'session-1', passport: { user: 'user-1' } }]),
  ),
});

describe('resolveSessionAccess / canSelectSessions', () => {
  test.each([
    {
      label:
        'the default GROWI configuration (connect-mongo): the collection behind the store is reachable',
      buildStore: () =>
        buildConnectMongoStore(Promise.resolve(buildSessionsCollection())),
      selectable: true,
    },
    {
      label:
        'connect-mongo without a reachable collection: `all()` alone cannot identify a session',
      buildStore: () => buildConnectMongoStore(undefined),
      selectable: false,
    },
    {
      label:
        'connect-mongo whose collection promise rejects: the means is gone, so the capability is gone with it',
      buildStore: () =>
        buildConnectMongoStore(Promise.reject(new Error('no connection'))),
      selectable: false,
    },
    {
      label: 'connect-redis: enumeration reports each session id',
      buildStore: buildConnectRedisStore,
      selectable: true,
    },
    {
      label: 'a store that can only get/set/destroy one session at a time',
      buildStore: () => ({ get: vi.fn(), set: vi.fn(), destroy: vi.fn() }),
      selectable: false,
    },
    {
      label: 'no session store configured at all',
      buildStore: () => undefined,
      selectable: false,
    },
  ])('reports selectable=$selectable for $label', async ({
    buildStore,
    selectable,
  }) => {
    const access = await resolveSessionAccess(buildStore());

    expect(canSelectSessions(access)).toBe(selectable);
  });

  test('hands the destroy side the very collection the store reads and writes', async () => {
    // The capability and the means are the same answer: what makes
    // `sessionStoreSupportsEnumeration` true is that this collection came back, and it is
    // the same object the destroy side (task 9.2) selects sessions in. Deriving the two
    // separately is how a destination ends up announcing support and destroying nothing.
    const sessionsCollection = buildSessionsCollection();
    const store = buildConnectMongoStore(Promise.resolve(sessionsCollection));

    const access = await resolveSessionAccess(store);

    expect(access.kind).toBe('sessions-collection');
    if (access.kind === 'sessions-collection') {
      expect(access.sessionsCollection).toBe(sessionsCollection);
      expect(access.store).toBe(store);
    }
  });

  test('hands the destroy side the store itself when the store reports session ids', async () => {
    const store = buildConnectRedisStore();

    const access = await resolveSessionAccess(store);

    expect(access.kind).toBe('store-enumeration');
    if (access.kind === 'store-enumeration') {
      expect(access.store).toBe(store);
    }
    // No collection is offered for this store: reading `sessions` in MongoDB would find
    // nothing, since this GROWI keeps its sessions in Redis.
    expect(access).not.toHaveProperty('sessionsCollection');
  });

  test('carries no means at all when sessions cannot be selected', async () => {
    const access = await resolveSessionAccess(
      buildConnectMongoStore(undefined),
    );

    expect(access).toEqual({ kind: 'unsupported' });
  });

  test('does not throw when the store cannot produce its collection', async () => {
    await expect(
      resolveSessionAccess(
        buildConnectMongoStore(Promise.reject(new Error('no connection'))),
      ),
    ).resolves.toEqual({ kind: 'unsupported' });
  });
});

/**
 * A session as `serializeUser` leaves it: `passport.user` carries `user.id`
 * (`service/passport.ts`), which is the hex string of the user's `_id` — never an
 * `ObjectId`. A session without `passport` is one nobody has logged into.
 */
const buildSession = (userId?: string): Record<string, unknown> => ({
  cookie: new Cookie(),
  ...(userId == null ? {} : { passport: { user: userId } }),
});

const storeSession = (
  store: { set: (id: string, session: unknown, cb: ErrorCallback) => void },
  sessionId: string,
  session: unknown,
): Promise<void> =>
  new Promise((resolve, reject) => {
    store.set(sessionId, session, (err) =>
      err != null ? reject(err) : resolve(),
    );
  });

const readSession = (
  store: { get: (id: string, cb: SessionCallback) => void },
  sessionId: string,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    store.get(sessionId, (err, session) =>
      err != null ? reject(err) : resolve(session),
    );
  });

/**
 * `connect-redis`'s store, reduced to the behaviour the destroy side depends on and backed
 * by a real map, so what a test observes is which sessions can still be read rather than
 * how many times `destroy` was called. `all()` answers the way v4 does: every parsed
 * session with `id` set to its key minus `prefix`
 * (`connect-redis/lib/connect-redis.js`) — the array form of "which session is this".
 */
const buildRedisLikeStore = (sessions: Map<string, unknown>) => ({
  prefix: 'sess:',
  client: { mget: vi.fn() },
  get: (sessionId: string, callback: SessionCallback) =>
    callback(null, sessions.get(sessionId) ?? null),
  set: (sessionId: string, session: unknown, callback: ErrorCallback) => {
    sessions.set(sessionId, session);
    callback(null);
  },
  destroy: (sessionId: string, callback: ErrorCallback) => {
    sessions.delete(sessionId);
    callback(null);
  },
  all: (callback: SessionsCallback) =>
    callback(
      null,
      [...sessions].map(([id, session]) => ({
        ...(session as Record<string, unknown>),
        id,
      })),
    ),
});

describe('invalidateSessionsExcept', () => {
  // The rescued administrator keeps their identifier (requirement 4.3), so their session
  // has to survive the replacement; every other user's account is gone after it, and their
  // session has to go with it (requirement 5.5).
  const rescuedUserId = new ObjectId('0123456789abcdef01250001');
  const replacedUserId = new ObjectId('0123456789abcdef01250002');

  const seedSessions = async (store: {
    set: (id: string, session: unknown, cb: ErrorCallback) => void;
  }): Promise<void> => {
    await storeSession(
      store,
      'session-rescued',
      buildSession(rescuedUserId.toHexString()),
    );
    await storeSession(
      store,
      'session-replaced',
      buildSession(replacedUserId.toHexString()),
    );
    await storeSession(store, 'session-anonymous', buildSession());
  };

  describe('a store whose enumeration reports session ids', () => {
    // `express-session`'s own `MemoryStore` is real code that answers `all()` with a map
    // keyed by session id — the same "which session is this" the `store-enumeration`
    // variant is defined by, in the other of the two shapes `all()` is allowed to take.
    // (`resolveSessionAccess` would not pick this variant for a `MemoryStore` deployment;
    // it recognises `connect-redis` only. The variant is handed in directly because the
    // destroy side takes the chosen means as its input.)
    test('destroys the replaced users’ sessions and keeps the rescued account’s', async () => {
      const store = new MemoryStore();
      await seedSessions(store);

      // The identifiers to keep arrive as `ObjectId`s: that is what a `lean()` read of the
      // rescued administrators hands back, while the session carries the hex string.
      const result = await invalidateSessionsExcept(
        { kind: 'store-enumeration', store },
        [rescuedUserId],
      );

      await expect(
        readSession(store, 'session-rescued'),
      ).resolves.toMatchObject({
        passport: { user: rescuedUserId.toHexString() },
      });
      await expect(
        readSession(store, 'session-replaced'),
      ).resolves.toBeUndefined();
      // Nobody is logged into this one, so it is not a replaced user's session.
      await expect(
        readSession(store, 'session-anonymous'),
      ).resolves.toBeDefined();
      expect(result).toEqual({ destroyed: 1, skipped: 2, unsupported: false });
    });

    test('accepts the identifiers to keep as hex strings too', async () => {
      const store = new MemoryStore();
      await seedSessions(store);

      const result = await invalidateSessionsExcept(
        { kind: 'store-enumeration', store },
        [rescuedUserId.toHexString()],
      );

      await expect(
        readSession(store, 'session-rescued'),
      ).resolves.toBeDefined();
      await expect(
        readSession(store, 'session-replaced'),
      ).resolves.toBeUndefined();
      expect(result).toEqual({ destroyed: 1, skipped: 2, unsupported: false });
    });

    test('destroys through the store when its enumeration labels each session with its id', async () => {
      const sessions = new Map<string, unknown>();
      const store = buildRedisLikeStore(sessions);
      await seedSessions(store);

      const result = await invalidateSessionsExcept(
        { kind: 'store-enumeration', store },
        [rescuedUserId],
      );

      await expect(
        readSession(store, 'session-rescued'),
      ).resolves.toMatchObject({
        passport: { user: rescuedUserId.toHexString() },
      });
      await expect(readSession(store, 'session-replaced')).resolves.toBeNull();
      // Asserted positively: this store answers `null` for a session that is gone, and
      // `null` satisfies `toBeDefined()`.
      await expect(
        readSession(store, 'session-anonymous'),
      ).resolves.toMatchObject({ cookie: expect.anything() });
      expect(result).toEqual({ destroyed: 1, skipped: 2, unsupported: false });
    });
  });

  test('reports that it could not select anything when the store turns out not to enumerate', async () => {
    // `resolveSessionAccess` never chooses this variant for such a store, and nothing in
    // the type system says so — `express-session` ships no type declarations. If this
    // guard is ever dropped, the enumeration rejects rather than never answering, so the
    // caller (task 9.3, inside its `finally`) fails instead of waiting forever.
    const store = { get: vi.fn(), set: vi.fn(), destroy: vi.fn() };

    await expect(
      invalidateSessionsExcept({ kind: 'store-enumeration', store }, []),
    ).resolves.toEqual({ destroyed: 0, skipped: 0, unsupported: true });
  });

  describe('a store that offers no way to pick out one session', () => {
    test('destroys nothing and reports that it could not', async () => {
      // The same store the enumeration cases destroy from, taken through the resolution
      // this time: it has no `collectionP` and is not `connect-redis`, so no mechanism is
      // chosen — and then nothing may be destroyed, or the destination would be reporting
      // a capability (requirement 3.7's warning) that it does not have.
      const store = new MemoryStore();
      await seedSessions(store);
      // Resolved rather than written by hand, so a store the destination misjudges as
      // selectable is caught here by the sessions it then destroys.
      const access = await resolveSessionAccess(store);

      const result = await invalidateSessionsExcept(access, [rescuedUserId]);

      await expect(
        readSession(store, 'session-rescued'),
      ).resolves.toBeDefined();
      await expect(
        readSession(store, 'session-replaced'),
      ).resolves.toBeDefined();
      await expect(
        readSession(store, 'session-anonymous'),
      ).resolves.toBeDefined();
      expect(result).toEqual({ destroyed: 0, skipped: 0, unsupported: true });
    });
  });
});
