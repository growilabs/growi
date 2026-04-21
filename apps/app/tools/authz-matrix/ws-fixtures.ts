/**
 * WebSocket-specific fixtures for the /yjs/<pageId> and socket.io
 * authorization matrix baseline (task 0.3.2).
 *
 * Why not reuse the HTTP-side `personas.ts` injector?
 *   The apiv3 matrix uses a test-only Express middleware that populates
 *   `req.user` from an `x-authz-matrix-persona` header. That bypass
 *   cannot work for WebSocket upgrade because:
 *     - the yjs upgrade handler in `service/yjs/upgrade-handler.ts`
 *       runs BEFORE the Express middleware chain — it reads the session
 *       directly from the cookie via `expressSession(...)` / `passport.session()`
 *     - socket.io's `engine.use(expressSession(...))` likewise consumes
 *       the cookie, not the injector header
 *   So the WS capture needs a genuine express-session cookie, which means
 *   a real login round-trip.
 *
 * Responsibilities of this module:
 *   1. Seed an `authz-matrix-ws-user` local user with a known password
 *   2. Seed two pages:
 *        - one the user CAN view (GRANT_PUBLIC)
 *        - one the user CANNOT view (GRANT_OWNER by a different user)
 *   3. Log the user in via POST /_api/v3/login and extract the
 *      session cookie (`connect.sid=...`) from Set-Cookie
 *
 * Requirements covered: 2.6, 6.5
 */

import { request as httpRequest } from 'node:http';
import type { Types } from 'mongoose';

import type Crowi from '~/server/crowi';

// Deterministic fixture identities — usernames / paths are stable across
// reruns so the baseline stays byte-identical.
const WS_USER_USERNAME = 'authz-matrix-ws-user';
const WS_USER_PASSWORD = 'authz-matrix-ws-user-password';
const WS_OTHER_USERNAME = 'authz-matrix-ws-other';

export const WS_VIEWABLE_PAGE_PATH = '/authz-matrix-ws/viewable';
export const WS_UNVIEWABLE_PAGE_PATH = '/authz-matrix-ws/unviewable';

// Mirrors PageGrant values in packages/core/src/interfaces/page.ts. Kept
// local so this tool does not reach into the Page model's consts module.
const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;

// Mirrors UserStatus.STATUS_ACTIVE (see models/user).
const STATUS_ACTIVE = 2;

type UserDoc = {
  _id: Types.ObjectId;
  username: string;
  admin: boolean;
  readOnly: boolean;
  status: number;
  setPassword?: (pw: string) => unknown;
  save?: () => Promise<unknown>;
};

type PageDoc = {
  _id: Types.ObjectId;
  path: string;
  grant: number;
};

export type WsSeededFixtures = {
  readonly userId: Types.ObjectId;
  readonly username: string;
  readonly password: string;
  readonly viewablePageId: Types.ObjectId;
  readonly unviewablePageId: Types.ObjectId;
};

/**
 * Seed a local-password user and two pages — one viewable by the user
 * and one owned by a different user (and therefore not viewable).
 *
 * Idempotent: rerunning updates the existing docs in place so usernames
 * and page paths never collide and the baseline stays deterministic.
 */
export async function seedWsFixtures(crowi: Crowi): Promise<WsSeededFixtures> {
  // biome-ignore lint/suspicious/noExplicitAny: User model typing is broad.
  const User = crowi.models.User as any;
  if (User == null) {
    throw new Error(
      '[ws-authz] crowi.models.User is not available — call Crowi.init() first',
    );
  }
  // biome-ignore lint/suspicious/noExplicitAny: Page model typing is broad.
  const Page = crowi.models.Page as any;
  if (Page == null) {
    throw new Error(
      '[ws-authz] crowi.models.Page is not available — call Crowi.init() first',
    );
  }

  // Ensure the test user exists with a known password so we can log in
  // via POST /_api/v3/login. setPassword uses crowi.env.PASSWORD_SEED so
  // the server-side hash will match whatever seed this process boots with.
  const ensureLocalUser = async (
    username: string,
    password: string | null,
  ): Promise<UserDoc> => {
    const existing = (await User.findOne({
      username,
    }).exec()) as UserDoc | null;
    if (existing != null) {
      existing.admin = false;
      existing.readOnly = false;
      existing.status = STATUS_ACTIVE;
      if (password != null && typeof existing.setPassword === 'function') {
        existing.setPassword(password);
      }
      if (typeof existing.save === 'function') {
        await existing.save();
      }
      return existing;
    }

    const created = new User({
      name: username,
      username,
      email: `${username}@authz-matrix.local`,
      lang: 'en_US',
      status: STATUS_ACTIVE,
      admin: false,
      readOnly: false,
    }) as UserDoc;
    if (password != null && typeof created.setPassword === 'function') {
      created.setPassword(password);
    }
    if (typeof created.save === 'function') {
      await created.save();
    }
    return created;
  };

  const wsUser = await ensureLocalUser(WS_USER_USERNAME, WS_USER_PASSWORD);
  // The "other" user only exists to own the unviewable page; it never logs in.
  const otherUser = await ensureLocalUser(WS_OTHER_USERNAME, null);

  // Seed pages. Use findOneAndUpdate with upsert so the baseline remains
  // deterministic even if a prior run left partial state.
  const upsertPage = async (
    path: string,
    grant: number,
    ownerId: Types.ObjectId,
  ): Promise<PageDoc> => {
    const existing = (await Page.findOne({ path }).exec()) as PageDoc | null;
    if (existing != null) {
      await Page.updateOne(
        { _id: existing._id },
        {
          $set: {
            grant,
            grantedUsers: grant === GRANT_OWNER ? [ownerId] : [],
            creator: ownerId,
            isEmpty: false,
          },
        },
      ).exec();
      const reloaded = (await Page.findOne({
        path,
      }).exec()) as PageDoc | null;
      if (reloaded == null) {
        throw new Error(`[ws-authz] seeded page ${path} disappeared`);
      }
      return reloaded;
    }
    const created = (await Page.create({
      path,
      grant,
      grantedUsers: grant === GRANT_OWNER ? [ownerId] : [],
      creator: ownerId,
      isEmpty: false,
    })) as PageDoc;
    return created;
  };

  const viewablePage = await upsertPage(
    WS_VIEWABLE_PAGE_PATH,
    GRANT_PUBLIC,
    wsUser._id,
  );
  const unviewablePage = await upsertPage(
    WS_UNVIEWABLE_PAGE_PATH,
    GRANT_OWNER,
    // Owned by someone else → wsUser cannot view it.
    otherUser._id,
  );

  return {
    userId: wsUser._id,
    username: WS_USER_USERNAME,
    password: WS_USER_PASSWORD,
    viewablePageId: viewablePage._id,
    unviewablePageId: unviewablePage._id,
  };
}

type LoginResult = {
  readonly cookie: string;
  readonly status: number;
};

/**
 * POST /_api/v3/login against the running HTTP listener and extract the
 * session cookie. Returns the full `Cookie:` header value (currently just
 * `connect.sid=<sid>`) that subsequent WebSocket connects should attach.
 *
 * The HTTP listener must already be up on `localhost:<port>` before this
 * is called.
 */
export function loginAndExtractCookie(
  port: number,
  username: string,
  password: string,
): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      loginForm: { username, password },
    });
    const req = httpRequest(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/_api/v3/login',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json',
        },
      },
      (res) => {
        // Drain response body to free the socket.
        res.resume();
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie == null || setCookie.length === 0) {
            reject(
              new Error(
                `[ws-authz] login response had no Set-Cookie (status=${res.statusCode})`,
              ),
            );
            return;
          }
          // Pluck the cookie name=value pair (drop Path / HttpOnly / etc).
          const cookiePairs = setCookie.map((c) => c.split(';', 1)[0].trim());
          const cookieHeader = cookiePairs.join('; ');
          resolve({ cookie: cookieHeader, status: res.statusCode ?? 0 });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('[ws-authz] login request timed out'));
    });
    req.write(payload);
    req.end();
  });
}
