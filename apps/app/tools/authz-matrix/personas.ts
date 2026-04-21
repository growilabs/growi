/**
 * Persona seeding and lookup for the apiv3 authorization matrix baseline.
 *
 * Seeds two users directly via the User Mongoose model:
 *   - `authz-matrix-admin`    — admin: true,  readOnly: false
 *   - `authz-matrix-readonly` — admin: false, readOnly: true
 *
 * The other two personas need no seeded user:
 *   - `unauthenticated` — no credentials, `security:isGuesAllowedToRead=false`
 *   - `guest`           — no credentials, `security:isGuesAllowedToRead=true`
 *
 * The capture driver flips the guest-ACL config between persona passes so
 * the two columns have distinct meaning. Authenticated personas are
 * unaffected by the ACL toggle because `loginRequired` consults the ACL
 * only when `req.user == null`.
 *
 * Requirements covered: 2.6, 2.8, 6.5
 */

import type { Express } from 'express';
import type { Types } from 'mongoose';

import type Crowi from '~/server/crowi';

export type PersonaName = 'unauthenticated' | 'guest' | 'readonly' | 'admin';

export const PERSONA_NAMES: readonly PersonaName[] = [
  'unauthenticated',
  'guest',
  'readonly',
  'admin',
] as const;

export const TEST_PERSONA_HEADER = 'x-authz-matrix-persona';

export type SeededPersonas = {
  readonly adminUserId: Types.ObjectId;
  readonly readonlyUserId: Types.ObjectId;
};

type UserDocumentLike = {
  _id: Types.ObjectId;
  name: string;
  username: string;
  admin: boolean;
  readOnly: boolean;
  status: number;
};

// Deterministic usernames so the seed is idempotent and the baseline stays
// byte-stable across reruns (no timestamps, no random UUIDs).
const ADMIN_USERNAME = 'authz-matrix-admin';
const READONLY_USERNAME = 'authz-matrix-readonly';

// UserStatus.STATUS_ACTIVE (mirrors ~/server/models/user/conts without
// forcing the capture script to import the full model module).
const STATUS_ACTIVE = 2;

export async function seedPersonas(crowi: Crowi): Promise<SeededPersonas> {
  const User = crowi.models.User as unknown as {
    findOne(q: Record<string, unknown>): {
      exec(): Promise<UserDocumentLike | null>;
    };
    create(doc: Record<string, unknown>): Promise<UserDocumentLike>;
    updateOne(
      q: Record<string, unknown>,
      u: Record<string, unknown>,
    ): { exec(): Promise<unknown> };
  };
  if (User == null) {
    throw new Error(
      '[authz-matrix] crowi.models.User is not available — call Crowi.init() first',
    );
  }

  const ensureUser = async (
    username: string,
    overrides: { admin: boolean; readOnly: boolean },
  ): Promise<UserDocumentLike> => {
    const existing = await User.findOne({ username }).exec();
    if (existing != null) {
      // Force the persona flags to canonical baseline values so reruns are
      // deterministic even if a prior run left the docs in an inconsistent
      // state.
      await User.updateOne(
        { username },
        {
          $set: {
            admin: overrides.admin,
            readOnly: overrides.readOnly,
            status: STATUS_ACTIVE,
          },
        },
      ).exec();
      const reloaded = await User.findOne({ username }).exec();
      if (reloaded == null) {
        throw new Error(
          `[authz-matrix] persona ${username} disappeared after update`,
        );
      }
      return reloaded;
    }

    return User.create({
      name: username,
      username,
      email: `${username}@authz-matrix.local`,
      password: 'authz-matrix-pw-not-used',
      lang: 'en_US',
      status: STATUS_ACTIVE,
      admin: overrides.admin,
      readOnly: overrides.readOnly,
    });
  };

  const admin = await ensureUser(ADMIN_USERNAME, {
    admin: true,
    readOnly: false,
  });
  const readonly = await ensureUser(READONLY_USERNAME, {
    admin: false,
    readOnly: true,
  });

  return {
    adminUserId: admin._id,
    readonlyUserId: readonly._id,
  };
}

/**
 * Register a test-only middleware on the Express app that reads the
 * `x-authz-matrix-persona` header and populates `req.user` accordingly.
 *
 * This must be attached BEFORE the apiv3 routes are mounted by
 * `setupRoutesAtLast`. The middleware does not short-circuit; it only
 * provides a deterministic way to simulate an authenticated session without
 * requiring passport login / session cookies.
 *
 * For `guest` / `unauthenticated` personas the injector leaves `req.user`
 * untouched. The distinction between those two columns is expressed at the
 * ACL layer (`security:isGuesAllowedToRead`) which the capture driver
 * toggles between the two passes.
 */
export async function registerPersonaInjector(
  app: Express,
  crowi: Crowi,
  seeded: SeededPersonas,
): Promise<void> {
  const User = crowi.models.User as unknown as {
    findById(id: Types.ObjectId): { exec(): Promise<UserDocumentLike | null> };
  };
  if (User == null) {
    throw new Error(
      '[authz-matrix] crowi.models.User is not available — call Crowi.init() first',
    );
  }

  const adminUser = await User.findById(seeded.adminUserId).exec();
  const readonlyUser = await User.findById(seeded.readonlyUserId).exec();
  if (adminUser == null || readonlyUser == null) {
    throw new Error(
      '[authz-matrix] persona injector could not load seeded users',
    );
  }

  app.use(function authzMatrixPersonaInjector(req, _res, next) {
    const header = req.header(TEST_PERSONA_HEADER);
    if (header == null || header === '') {
      next();
      return;
    }

    switch (header as PersonaName) {
      case 'unauthenticated':
      case 'guest':
        // No user attached; distinction lives at the ACL layer.
        break;
      case 'readonly':
        // biome-ignore lint/suspicious/noExplicitAny: Attaching to req.
        (req as any).user = readonlyUser;
        break;
      case 'admin':
        // biome-ignore lint/suspicious/noExplicitAny: Attaching to req.
        (req as any).user = adminUser;
        break;
      default:
        break;
    }
    next();
  });
}
