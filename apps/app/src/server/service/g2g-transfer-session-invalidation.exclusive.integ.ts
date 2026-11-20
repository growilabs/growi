import MongoStore from 'connect-mongo';
import { Cookie } from 'express-session';
import type { Collection } from 'mongodb';
import mongoose from 'mongoose';

import {
  invalidateSessionsExcept,
  resolveSessionAccess,
  type SessionAccess,
  type StoredSessionDocument,
} from './g2g-transfer-session-invalidation';

/**
 * The default GROWI deployment keeps its sessions in MongoDB (`crowi/index.ts` falls back
 * to `connect-mongo` when no Redis URL is set), and that is the path the store API alone
 * cannot serve. Everything here therefore runs against a real `connect-mongo` store: it
 * writes the documents, so the JSON the destroy side reads is the JSON the product wrote,
 * and `store.get` — not a count of `destroy` calls — decides whether a session survived.
 *
 * `.exclusive.integ.ts`, and therefore a database of its own: the function under test
 * reaches every readable document in the `sessions` collection, which with an empty keep
 * set means all of them. In the database that the other integration files share per
 * worker, that would take any session they had seeded with it.
 */

type ErrorCallback = (err: unknown) => void;
type SessionCallback = (err: unknown, session?: unknown) => void;

interface MongoSessionStore {
  set(sessionId: string, session: unknown, callback: ErrorCallback): void;
  get(sessionId: string, callback: SessionCallback): void;
}

// Session ids are fixed rather than generated so that cleanup also removes what a crashed
// earlier run left behind: the document `_id` is the session id, and it is the only unique
// field a session document has.
const SESSION_ID_PREFIX = 'g2g-session-invalidation-';
const SESSION_IDS = {
  rescued: `${SESSION_ID_PREFIX}rescued`,
  replaced: `${SESSION_ID_PREFIX}replaced`,
  otherReplaced: `${SESSION_ID_PREFIX}other-replaced`,
  anonymous: `${SESSION_ID_PREFIX}anonymous`,
  unreadable: `${SESSION_ID_PREFIX}unreadable`,
} as const;

// The rescued administrator keeps the identifier they had before the transfer
// (requirement 4.3); the other two are users the replacement removes (requirement 5.5).
const RESCUED_USER_ID = new mongoose.Types.ObjectId('0123456789abcdef01260001');
const REPLACED_USER_ID = new mongoose.Types.ObjectId(
  '0123456789abcdef01260002',
);
const OTHER_REPLACED_USER_ID = new mongoose.Types.ObjectId(
  '0123456789abcdef01260003',
);

describe('invalidateSessionsExcept on the MongoDB session store', () => {
  let store: MongoSessionStore;
  let access: SessionAccess;
  let sessionsCollection: Collection<StoredSessionDocument>;

  const removeFixtures = async (): Promise<void> => {
    await sessionsCollection.deleteMany({
      _id: { $in: Object.values(SESSION_IDS) },
    });
  };

  /** Written through the store, so the stored shape is the product's, not the test's. */
  const seedSession = (sessionId: string, userId?: string): Promise<void> =>
    new Promise((resolve, reject) => {
      store.set(
        sessionId,
        {
          cookie: new Cookie(),
          // `serializeUser` puts `user.id` here — the hex string of the user's `_id`.
          ...(userId == null ? {} : { passport: { user: userId } }),
        },
        (err) => (err != null ? reject(err) : resolve()),
      );
    });

  const readSession = (sessionId: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      store.get(sessionId, (err, session) =>
        err != null ? reject(err) : resolve(session),
      );
    });

  beforeAll(async () => {
    // `autoRemove: 'disabled'` only skips the TTL index this store would otherwise create
    // in the shared test database; it changes nothing about how sessions are stored.
    store = MongoStore.create({
      client: mongoose.connection.getClient(),
      autoRemove: 'disabled',
    });

    access = await resolveSessionAccess(store);
    if (access.kind !== 'sessions-collection') {
      throw new Error(
        `The default MongoDB session store must be selectable, but the resolution chose "${access.kind}"`,
      );
    }
    sessionsCollection = access.sessionsCollection;

    await removeFixtures();
  });

  afterEach(async () => {
    await removeFixtures();
  });

  test('destroys the replaced users’ sessions and keeps the rescued account’s', async () => {
    await seedSession(SESSION_IDS.rescued, RESCUED_USER_ID.toHexString());
    await seedSession(SESSION_IDS.replaced, REPLACED_USER_ID.toHexString());
    await seedSession(
      SESSION_IDS.otherReplaced,
      OTHER_REPLACED_USER_ID.toHexString(),
    );
    await seedSession(SESSION_IDS.anonymous);

    // The identifiers to keep arrive as `ObjectId`s — the form a `lean()` read of the
    // rescued administrators produces — while the session carries the hex string.
    const result = await invalidateSessionsExcept(access, [RESCUED_USER_ID]);

    await expect(readSession(SESSION_IDS.rescued)).resolves.toMatchObject({
      passport: { user: RESCUED_USER_ID.toHexString() },
    });
    await expect(readSession(SESSION_IDS.replaced)).resolves.toBeNull();
    await expect(readSession(SESSION_IDS.otherReplaced)).resolves.toBeNull();
    // Nobody is logged into this one, so it is not a replaced user's session.
    // Asserted positively: this store answers `null` for a session that is gone, and
    // `null` satisfies `toBeDefined()` — so "survived" has to be shown, not merely not-absent.
    await expect(readSession(SESSION_IDS.anonymous)).resolves.toMatchObject({
      cookie: expect.anything(),
    });
    expect(result).toEqual({ destroyed: 2, skipped: 2, unsupported: false });
  });

  test('leaves a session it cannot read, rather than guessing whose it is', async () => {
    await seedSession(SESSION_IDS.rescued, RESCUED_USER_ID.toHexString());
    await sessionsCollection.insertOne({
      _id: SESSION_IDS.unreadable,
      session: '{"passport":',
      expires: new Date(Date.now() + 3600_000),
    });

    const result = await invalidateSessionsExcept(access, [RESCUED_USER_ID]);

    // Read through the collection: the store itself cannot parse this document either.
    await expect(
      sessionsCollection.countDocuments({ _id: SESSION_IDS.unreadable }),
    ).resolves.toBe(1);
    await expect(readSession(SESSION_IDS.rescued)).resolves.toMatchObject({
      passport: { user: RESCUED_USER_ID.toHexString() },
    });
    expect(result).toEqual({ destroyed: 0, skipped: 2, unsupported: false });
  });

  test('destroys every logged-in session when no account is rescued', async () => {
    await seedSession(SESSION_IDS.replaced, REPLACED_USER_ID.toHexString());
    await seedSession(SESSION_IDS.anonymous);

    const result = await invalidateSessionsExcept(access, []);

    await expect(readSession(SESSION_IDS.replaced)).resolves.toBeNull();
    await expect(readSession(SESSION_IDS.anonymous)).resolves.toMatchObject({
      cookie: expect.anything(),
    });
    expect(result).toEqual({ destroyed: 1, skipped: 1, unsupported: false });
  });
});
