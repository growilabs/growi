import {
  canSelectSessions,
  resolveSessionAccess,
} from './g2g-transfer-session-invalidation';

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
