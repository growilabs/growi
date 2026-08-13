/**
 * How the destination of a G2G transfer reaches individual login sessions.
 *
 * A migration transfer replaces the destination's users, so the sessions established
 * before it point at accounts that no longer exist: their `deserializeUser` throws and
 * the browser keeps failing every request instead of falling back to anonymous. Cutting
 * them is requirement 5.5, and keeping the rescued administrator's own session is
 * requirement 4.3.
 *
 * Whether that is possible at all depends on where the sessions are kept, and the
 * destination has to answer that question *before* the transfer starts so the operator
 * can be warned (requirement 3.7). This module is where both answers come from, and
 * deliberately from the same call: {@link resolveSessionAccess} produces the means, and
 * {@link canSelectSessions} reports whether there is one. Announcing support that no
 * mechanism backs is the failure this shape exists to make unrepresentable — the
 * destination would suppress the operator's warning and then destroy nothing.
 *
 * Why "does the store have `all()`?" is not that question: `connect-mongo`'s `all()`
 * returns `unserialize(session.session)` for every stored document and no session ids
 * (`connect-mongo/build/main/lib/MongoStore.js`), while `destroy(sid)` needs one — so
 * every session comes back and not one of them can be picked out. That is GROWI's default
 * configuration (`crowi/index.ts` falls back to `connect-mongo` when no Redis URL is
 * set), i.e. exactly the deployment such a check would be wrong about. `connect-redis`'s
 * `all()` does label each session with its id (`connect-redis/lib/connect-redis.js`), so
 * there the store API is enough.
 *
 * Design note: design.md types `SessionAccess` as `{ store, sessionsCollection? }` with a
 * separate `canSelectSessions(access)`. It is a discriminated union here because that
 * shape cannot tell "Redis, selectable through the store" from "some other store, not
 * selectable" without re-deriving the store kind inside `canSelectSessions` — a second
 * judgement, which is the very thing the requirement forbids. The union carries the
 * chosen mechanism instead, so the capability and the means cannot drift apart, and the
 * destroy side (task 9.2) switches on `kind` exhaustively.
 */

import type { Store } from 'express-session';
import type { Collection } from 'mongodb';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:g2g-transfer-session-invalidation');

/**
 * A session as `connect-mongo` stores it: the document id *is* the session id, and the
 * session itself is a serialized string by default (`stringify: true`), which is how
 * GROWI configures it. The destroy side parses that string to find out whose session it
 * is (`passport.user`, put there by `serializeUser` in `service/passport.ts`).
 */
export interface StoredSessionDocument {
  _id: string;
  session: string;
  expires?: Date;
}

export type SessionAccess =
  /** Sessions are MongoDB documents; they are selected and removed in this collection. */
  | {
      readonly kind: 'sessions-collection';
      readonly store: Store;
      readonly sessionsCollection: Collection<StoredSessionDocument>;
    }
  /** The store's own enumeration reports session ids, so `all()` / `destroy()` suffice. */
  | { readonly kind: 'store-enumeration'; readonly store: Store }
  /** No way to pick out one session, so none may be destroyed and the operator is warned. */
  | { readonly kind: 'unsupported' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  isRecord(value) && typeof value.then === 'function';

const isSessionStore = (value: unknown): value is Store =>
  isRecord(value) &&
  typeof value.get === 'function' &&
  typeof value.set === 'function' &&
  typeof value.destroy === 'function';

/** The two operations the destroy side performs on it (task 9.2). */
const isSessionsCollection = (
  value: unknown,
): value is Collection<StoredSessionDocument> =>
  isRecord(value) &&
  typeof value.find === 'function' &&
  typeof value.deleteMany === 'function';

/**
 * The MongoDB collection a `connect-mongo` store reads and writes, taken from the store
 * itself rather than guessed from the mongoose connection: the collection name and the
 * database are the store's options, and a guess that misses them would delete nothing
 * while reporting success.
 *
 * `collectionP` is the promise the store resolves before every one of its own operations,
 * and is public in `connect-mongo`'s type declarations. Any store that does not offer it
 * simply is not this kind of store — the caller then looks for another mechanism, so a
 * future `connect-mongo` that renames it costs a warning, not a silent no-op.
 */
const resolveSessionsCollection = async (
  store: Store,
): Promise<Collection<StoredSessionDocument> | undefined> => {
  if (!isRecord(store) || !isThenable(store.collectionP)) {
    return undefined;
  }

  try {
    const collection = await store.collectionP;
    return isSessionsCollection(collection) ? collection : undefined;
  } catch (err) {
    // Being unable to reach the collection is reported as "cannot select sessions", the
    // same as not having one: the operator is warned, and nothing claims otherwise.
    logger.warn(
      { err },
      'Could not reach the collection behind the session store',
    );
    return undefined;
  }
};

/**
 * Whether the store's enumeration reports which session each entry is.
 *
 * Recognises `connect-redis`'s `RedisStore` by the shape that produces those ids: it
 * scans its keys and strips `prefix` off each one to label the session it parsed. A store
 * is never accepted here merely for having `all()` — see the note at the top of this file.
 */
const enumeratesWithSessionIds = (store: Store): boolean =>
  isRecord(store) &&
  typeof store.all === 'function' &&
  typeof store.prefix === 'string' &&
  store.client != null;

/**
 * Works out how — or whether — this GROWI can pick out individual sessions.
 *
 * Takes the configured store (`crowi.sessionConfig.store`) rather than reading it itself,
 * so the answer is a plain function of the deployment's configuration and both callers,
 * the pre-transfer report and the invalidation, ask the same question of the same object.
 */
export async function resolveSessionAccess(
  store: unknown,
): Promise<SessionAccess> {
  if (!isSessionStore(store)) {
    return { kind: 'unsupported' };
  }

  const sessionsCollection = await resolveSessionsCollection(store);
  if (sessionsCollection != null) {
    return { kind: 'sessions-collection', store, sessionsCollection };
  }

  if (enumeratesWithSessionIds(store)) {
    return { kind: 'store-enumeration', store };
  }

  return { kind: 'unsupported' };
}

/**
 * Whether the sessions of replaced users can be invalidated, which is what the
 * destination reports as `sessionStoreSupportsEnumeration` (requirement 3.7).
 *
 * Reads nothing but the mechanism {@link resolveSessionAccess} already chose, so a `true`
 * here is by construction a mechanism the destroy side can use.
 */
export function canSelectSessions(access: SessionAccess): boolean {
  return access.kind !== 'unsupported';
}

export interface SessionInvalidationResult {
  /** Sessions removed because they belong to a user this transfer replaced. */
  readonly destroyed: number;
  /** Sessions left in place: the rescued accounts', and those nobody is logged into. */
  readonly skipped: number;
  /** True when no session could be picked out, so none was destroyed (requirement 3.7). */
  readonly unsupported: boolean;
}

/**
 * An identifier in either form a read produces. `serializeUser` writes `user.id` — the hex
 * string of `_id` — into the session (`service/passport.ts`), while a `lean()` read of the
 * rescued administrators hands back `ObjectId`s. Comparing the two forms as they come
 * matches nothing and silently keeps every session, so both sides go through
 * {@link normaliseUserId} first (tasks.md Implementation Notes, from the review of 7.2).
 *
 * Design note: design.md types this parameter `readonly string[]`. Accepting the `ObjectId`
 * form as well is what makes the mistake above unrepresentable at the call site instead of
 * merely documented; it is a widening, so a caller passing strings is unaffected.
 */
export type UserIdLike = string | { toHexString(): string };

/** One enumerated session, reduced to the two facts the choice is made from. */
interface SessionEntry {
  readonly sessionId?: string;
  readonly userId?: string;
}

const normaliseUserId = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  // An `ObjectId`, recognised by the method only it has rather than by importing the class
  // — mongoose and the driver each export their own, and both arrive here.
  if (isRecord(value) && typeof value.toHexString === 'function') {
    return String(value);
  }
  return undefined;
};

const parseStoredSession = (session: string): unknown => {
  try {
    return JSON.parse(session);
  } catch {
    // A session that cannot be read belongs to nobody this can name, and destroying it
    // would be a guess. Leaving it costs an unusable session; guessing could cut off the
    // rescued administrator, which is the one session that must survive (requirement 4.3).
    return undefined;
  }
};

/**
 * Whose session this is. `session.passport.user` is the only place that says so — a
 * dependency on the session's structure that is deliberate and documented, not incidental.
 */
const readSessionUserId = (session: unknown): string | undefined => {
  // `stringify: true` is `connect-mongo`'s default and GROWI's configuration, so what the
  // document holds is JSON; a store that hands over the object already parsed is read as-is.
  const parsed =
    typeof session === 'string' ? parseStoredSession(session) : session;
  if (!isRecord(parsed) || !isRecord(parsed.passport)) {
    return undefined;
  }
  return normaliseUserId(parsed.passport.user);
};

const invalidateInSessionsCollection = async (
  sessionsCollection: Collection<StoredSessionDocument>,
  keep: ReadonlySet<string>,
): Promise<SessionInvalidationResult> => {
  // The owner of a session is inside the serialized `session` field, so the choice cannot
  // be made by a query; the documents are read, chosen here, and removed in one statement.
  const sessionIdsToDestroy: string[] = [];
  let examined = 0;

  const cursor = sessionsCollection.find({}, { projection: { session: 1 } });
  for await (const document of cursor) {
    examined += 1;
    const userId = readSessionUserId(document.session);
    if (userId != null && !keep.has(userId)) {
      sessionIdsToDestroy.push(document._id);
    }
  }

  if (sessionIdsToDestroy.length > 0) {
    await sessionsCollection.deleteMany({ _id: { $in: sessionIdsToDestroy } });
  }

  return {
    destroyed: sessionIdsToDestroy.length,
    skipped: examined - sessionIdsToDestroy.length,
    unsupported: false,
  };
};

const enumerateSessions = (store: Store): Promise<unknown> =>
  new Promise((resolve, reject) => {
    if (typeof store.all !== 'function') {
      // Rejecting rather than leaving the promise unsettled: an optional call on a store
      // without `all` never invokes the callback, so the caller — task 9.3, inside its
      // `finally` — would wait for it for the rest of the process's life. Whoever removes
      // the guard in `invalidateThroughStore` gets an error, not a stalled transfer.
      reject(new Error('This session store does not enumerate its sessions'));
      return;
    }
    store.all((err: unknown, sessions: unknown) => {
      if (err != null) {
        reject(err);
        return;
      }
      resolve(sessions);
    });
  });

const destroySession = (store: Store, sessionId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    store.destroy(sessionId, (err: unknown) => {
      if (err != null) {
        reject(err);
        return;
      }
      resolve();
    });
  });

const toSessionEntries = (sessions: unknown): readonly SessionEntry[] => {
  // `connect-redis` answers with an array whose entries carry `id`; `express-session`'s own
  // stores answer with a map keyed by session id. Both say which session is which, which is
  // what makes this variant of `SessionAccess` selectable at all.
  if (Array.isArray(sessions)) {
    return sessions.map((session) => ({
      sessionId:
        isRecord(session) && typeof session.id === 'string'
          ? session.id
          : undefined,
      userId: readSessionUserId(session),
    }));
  }
  if (isRecord(sessions)) {
    return Object.entries(sessions).map(([sessionId, session]) => ({
      sessionId,
      userId: readSessionUserId(session),
    }));
  }
  return [];
};

const invalidateThroughStore = async (
  store: Store,
  keep: ReadonlySet<string>,
): Promise<SessionInvalidationResult> => {
  if (typeof store.all !== 'function') {
    // `resolveSessionAccess` only chooses this variant for a store that enumerates, so
    // this is unreachable through it — and the type system is no help here at all:
    // `express-session` ships no type declarations and this package compiles with
    // `noImplicitAny: false`, so `Store` is `any`. This check is the only thing standing
    // between a caller and a store that cannot enumerate, and reporting "nothing could be
    // selected" is the honest answer; claiming a successful destruction of zero is not.
    return { destroyed: 0, skipped: 0, unsupported: true };
  }

  const entries = toSessionEntries(await enumerateSessions(store));

  let destroyed = 0;
  for (const entry of entries) {
    if (
      entry.sessionId == null ||
      entry.userId == null ||
      keep.has(entry.userId)
    ) {
      continue;
    }
    // One command per session at a time, on purpose: `Promise.all` would open as many
    // concurrent commands as there are logged-in browsers, against a destination that is
    // already busy importing.
    // biome-ignore lint/performance/noAwaitInLoops: sequential by design, see above
    await destroySession(store, entry.sessionId);
    destroyed += 1;
  }

  return {
    destroyed,
    skipped: entries.length - destroyed,
    unsupported: false,
  };
};

const destroySessionsExcept = (
  access: SessionAccess,
  keep: ReadonlySet<string>,
): Promise<SessionInvalidationResult> => {
  switch (access.kind) {
    case 'sessions-collection':
      return invalidateInSessionsCollection(access.sessionsCollection, keep);
    case 'store-enumeration':
      return invalidateThroughStore(access.store, keep);
    case 'unsupported':
      // Nothing is destroyed here on purpose: this is the case the operator was warned
      // about before the transfer started (requirement 3.7), and a partial, unselective
      // sweep would log every user out of a destination nobody asked to lock out.
      return Promise.resolve({
        destroyed: 0,
        skipped: 0,
        unsupported: true,
      });
  }
};

/**
 * Destroys the sessions of the users this transfer replaced, keeping the sessions of the
 * accounts that were rescued (requirements 5.5 and 4.3).
 *
 * Takes the mechanism {@link resolveSessionAccess} already chose rather than working out
 * the store kind again, so what is destroyed and what the destination announced it could
 * destroy cannot disagree.
 */
export async function invalidateSessionsExcept(
  access: SessionAccess,
  keepUserIds: readonly UserIdLike[],
): Promise<SessionInvalidationResult> {
  const keep = new Set(
    keepUserIds.map(normaliseUserId).filter((id): id is string => id != null),
  );

  const result = await destroySessionsExcept(access, keep);

  // Counts only: a session id is a credential, and whose session it is is personal data.
  logger.info(
    {
      destroyed: result.destroyed,
      skipped: result.skipped,
      unsupported: result.unsupported,
    },
    'Invalidated the login sessions of replaced users',
  );

  return result;
}
