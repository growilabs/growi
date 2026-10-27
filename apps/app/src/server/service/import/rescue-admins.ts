import {
  getIdStringForRef,
  type HasObjectId,
  type IUserHasId,
} from '@growi/core';
import { Types } from 'mongoose';

import type { IAccessToken } from '~/server/models/access-token';
import { UserStatus } from '~/server/models/user/conts';

import type {
  ArchiveUserIdentity,
  UserUniqueField,
} from './detect-unique-conflicts';

/**
 * A destination administrator as it will be written back after the import.
 *
 * `email` is optional here although `IUser` declares it required: dropping a colliding
 * e-mail address is exactly what requirement 4.5 asks for, and the field is unique +
 * sparse in the schema, so "absent" is the only value that cannot collide. `password`,
 * `apiToken` and `admin` are carried over untouched (requirements 4.1, 4.2, 4.9).
 */
export type RescuedUser = Omit<IUserHasId, 'email'> & {
  readonly email?: string;
};

export interface RescuedAdmin {
  readonly user: RescuedUser;
  /** The saved values themselves, not Mongoose documents, so they can be re-inserted as they were. */
  readonly accessTokens: readonly (IAccessToken & HasObjectId)[];
  readonly originalUsername: string;
  readonly rescuedUsername: string;
  readonly emailRemoved: boolean;
  readonly slackMemberIdRemoved: boolean;
  readonly idReassigned: boolean;
}

export interface AdminRescuePlan {
  readonly rescued: readonly RescuedAdmin[];
}

/**
 * How a collision with the source archive is resolved, per unique field of `users`.
 *
 * Typed as a total map over {@link UserUniqueField}, which the detection publishes
 * alongside `USER_UNIQUE_FIELDS`: that declaration stays the single source, and a unique
 * index added there fails to compile here until its resolution is decided. An unhandled
 * field would make the whole re-insertion fail the unique check and leave the destination
 * without a single administrator (requirements 4.1, 4.8).
 */
const COLLISION_RESOLUTION = {
  // Required by the schema, so it is renamed rather than dropped.
  username: 'rename',
  // Unique + sparse, so being absent is enough to clear the collision.
  email: 'remove',
  slackMemberId: 'remove',
} as const satisfies Record<UserUniqueField, 'rename' | 'remove'>;

const RESCUED_USERNAME_SUFFIX = '-rescued';

const hasValue = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Whether the account can actually log in: `loginRequired` lets only active users through
 * (middlewares/login-required.ts), and an account with no password hash has no local
 * credential to log in with. Rescuing either of those would satisfy "an admin survived"
 * on paper while leaving nobody able to reach the destination.
 *
 * Exported because the destination reports how many administrators can log in before the
 * transfer starts (`answerGROWIInfo`, requirement 3.5), and that count means "how many
 * accounts the rescue would keep alive". Restating the rule there instead would let the
 * two drift: a destination could be told nobody will be locked out and then have every
 * administrator skipped by the rescue.
 *
 * Narrowed to the fields it reads so a caller holding a database document rather than a
 * plain `IUserHasId` can use the same rule.
 */
export const isLoginable = (
  user: Pick<IUserHasId, 'status' | 'password'>,
): boolean =>
  user.status === UserStatus.STATUS_ACTIVE && hasValue(user.password);

const isRemovedOnCollision = (
  field: UserUniqueField,
  value: string | undefined,
  archiveValues: ReadonlySet<string>,
): boolean =>
  COLLISION_RESOLUTION[field] === 'remove' &&
  hasValue(value) &&
  archiveValues.has(value);

/**
 * Picks a username no incoming document holds and no other rescued account has taken,
 * recording the choice in `takenUsernames` so the next caller cannot pick it again.
 */
const claimRescuedUsername = (
  originalUsername: string,
  takenUsernames: Set<string>,
): string => {
  let candidate = `${originalUsername}${RESCUED_USERNAME_SUFFIX}`;

  for (let seq = 2; takenUsernames.has(candidate); seq += 1) {
    candidate = `${originalUsername}${RESCUED_USERNAME_SUFFIX}-${seq}`;
  }

  takenUsernames.add(candidate);
  return candidate;
};

/**
 * Works out what has to be written back after the destination's users are replaced, so
 * that at least one administrator can still log in (requirement 4.1).
 *
 * Everything is decided against `archiveIdentity` — the values the incoming documents
 * occupy — because those documents win: they are inserted first and carry the source's
 * own identifiers. The rescued account steps aside wherever it would collide, and keeps
 * its password hash, its admin flag and its access tokens so that "log in as before" and
 * "keep using the token you had" stay true (requirements 4.2, 4.9).
 *
 * Nothing here reads or writes the database, and no group relation is produced: the
 * rescued account is an emergency administrator, not a member of the source's groups
 * (requirement 4.7). The input documents are left untouched.
 */
export function planAdminRescue(
  destinationAdmins: readonly IUserHasId[],
  destinationAccessTokens: readonly (IAccessToken & HasObjectId)[],
  archiveIdentity: ArchiveUserIdentity,
): AdminRescuePlan {
  const admins = destinationAdmins.filter((user) => user.admin);
  const loginableAdmins = admins.filter(isLoginable);

  // Seeded with both sides before any rename is decided, so a replacement can collide
  // with neither an incoming document nor an administrator that keeps its own name —
  // whatever order the administrators arrive in.
  const takenUsernames = new Set<string>([
    ...archiveIdentity.usernames,
    ...loginableAdmins.map((admin) => admin.username),
  ]);

  const rescued = loginableAdmins.map((admin): RescuedAdmin => {
    const { email, slackMemberId, ...preserved } = admin;

    const rescuedUsername = archiveIdentity.usernames.has(admin.username)
      ? claimRescuedUsername(admin.username, takenUsernames)
      : admin.username;

    const emailRemoved = isRemovedOnCollision(
      'email',
      email,
      archiveIdentity.emails,
    );
    const slackMemberIdRemoved = isRemovedOnCollision(
      'slackMemberId',
      slackMemberId,
      archiveIdentity.slackMemberIds,
    );

    // `_id` is declared as a string but a document read from MongoDB holds an ObjectId,
    // while the archive side is hex strings — comparing them unnormalised would report
    // "no collision" every time and requirement 4.10 would never fire.
    const idReassigned = archiveIdentity.ids.has(String(admin._id));
    const rescuedId = idReassigned
      ? new Types.ObjectId().toHexString()
      : admin._id;

    const user: RescuedUser = {
      ...preserved,
      _id: rescuedId,
      username: rescuedUsername,
      ...(emailRemoved || !hasValue(email) ? {} : { email }),
      ...(slackMemberIdRemoved || !hasValue(slackMemberId)
        ? {}
        : { slackMemberId }),
    };

    const accessTokens = destinationAccessTokens
      .filter((token) => getIdStringForRef(token.user) === String(admin._id))
      // A token still pointing at the old `_id` resolves to nobody once the account is
      // re-inserted under a new one (requirements 4.9, 4.10).
      .map((token) => ({ ...token, user: rescuedId }));

    return {
      user,
      accessTokens,
      originalUsername: admin.username,
      rescuedUsername,
      emailRemoved,
      slackMemberIdRemoved,
      idReassigned,
    };
  });

  return { rescued };
}
