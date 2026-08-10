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
