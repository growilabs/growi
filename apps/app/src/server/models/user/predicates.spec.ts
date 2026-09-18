import type { Response } from 'express';
import type { Request } from 'express-validator/src/base.js';
import { mock } from 'vitest-mock-extended';

import { excludeReadOnlyUser } from '../../middlewares/exclude-read-only-user';
import { UserStatus } from './conts';
import { isActiveUserStatus, isReadOnlyUser } from './predicates';

describe('isActiveUserStatus', () => {
  it('accepts only STATUS_ACTIVE', () => {
    expect(isActiveUserStatus(UserStatus.STATUS_ACTIVE)).toBe(true);

    for (const status of [
      UserStatus.STATUS_REGISTERED,
      UserStatus.STATUS_SUSPENDED,
      UserStatus.STATUS_DELETED,
      UserStatus.STATUS_INVITED,
    ]) {
      expect(isActiveUserStatus(status)).toBe(false);
    }
  });

  // Fail-closed: an unknown/absent status must never read as "may operate".
  // Deriving this from INACTIVE_USER_STATUSES would make these `true`.
  it('rejects a status that is absent or outside the known set', () => {
    expect(isActiveUserStatus(undefined)).toBe(false);
    expect(isActiveUserStatus(null)).toBe(false);
    expect(isActiveUserStatus(999)).toBe(false);
  });
});

describe('isReadOnlyUser', () => {
  it('is true only for a user whose readOnly flag is set', () => {
    expect(isReadOnlyUser({ readOnly: true })).toBe(true);
    expect(isReadOnlyUser({ readOnly: false })).toBe(false);
    expect(isReadOnlyUser({})).toBe(false);
    expect(isReadOnlyUser(null)).toBe(false);
    expect(isReadOnlyUser(undefined)).toBe(false);
  });

  // The whole point of extracting this predicate is that `resolveActor` and
  // `excludeReadOnlyUser` cannot drift apart. This asserts they agree on
  // every representative input rather than trusting that they look alike.
  it('agrees with excludeReadOnlyUser for every representative user', () => {
    const users = [{ readOnly: true }, { readOnly: false }, {}];

    for (const user of users) {
      const next = vi.fn();
      const apiv3Err = vi.fn();
      const req = mock<Request>({ user });
      const res = mock<Response & { apiv3Err: typeof apiv3Err }>({ apiv3Err });

      excludeReadOnlyUser(req, res, next);

      const deniedByMiddleware = apiv3Err.mock.calls.length > 0;
      expect(deniedByMiddleware).toBe(isReadOnlyUser(user));
      expect(next.mock.calls.length > 0).toBe(!isReadOnlyUser(user));
    }
  });
});
