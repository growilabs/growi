import type { IUser } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Model } from 'mongoose';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';
import { UserStatus } from '~/server/models/user/conts';

interface TestRequest extends Request {
  user?: unknown;
  crowi?: Crowi;
}

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

// Lets each test set req.user for the hoisted login-required mock below.
const currentUser = vi.hoisted<{ value: unknown }>(() => ({ value: null }));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

// Mirrors the real guest decision rather than waving every request through, so
// that WHICH factory a route picks is observable here: the guest-allowed variant
// admits a null user, the strict one 403s on an `/_api/` path. Nothing past that
// decision (ACL config, shared pages, non-active statuses) is reproduced.
vi.mock('~/server/middlewares/login-required', () => ({
  default:
    (_crowi: unknown, isGuestAllowed = false) =>
    (req: TestRequest, res: Response, next: NextFunction) => {
      req.user = currentUser.value;
      if (req.user == null && !isGuestAllowed) {
        res.sendStatus(403);
        return;
      }
      next();
    },
}));

describe('GET /usernames', () => {
  let app: express.Application;
  let crowi: Crowi;
  let User: Model<IUser>;
  // Deleting only what this suite created (not deleteMany({})) avoids wiping
  // fixtures other integ files are relying on when CI runs them against a
  // single shared MongoDB instance.
  const createdUserIds: Types.ObjectId[] = [];
  const createdActivityIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    crowi = await getInstance();
    // crowi.models.User is typed Model<any> (ModelsMapDependentOnCrowi);
    // retrieve it through mongoose.model to keep this Model<IUser>-typed.
    User = mongoose.model<IUser>('User');
    // Patches express.response.apiv3/apiv3Err with the real implementation
    // (same call production makes in apiv3/index.js) instead of a hand-rolled
    // stub, so error-shape assertions here would match production behavior.
    const responseModule = await import('./response');
    const addCustomFunctionToResponse =
      'default' in responseModule ? responseModule.default : responseModule;
    if (typeof addCustomFunctionToResponse !== 'function') {
      throw new Error('Module does not export a function');
    }
    addCustomFunctionToResponse(express);
  });

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    app.use((req: TestRequest, _res, next) => {
      req.crowi = crowi;
      next();
    });

    const { setup } = await import('./users');
    const usersRouter = setup(crowi);
    app.use('/', usersRouter);
  });

  afterEach(async () => {
    currentUser.value = null;
    await Promise.all([
      User.deleteMany({ _id: { $in: createdUserIds } }),
      Activity.deleteMany({ _id: { $in: createdActivityIds } }),
    ]);
    createdUserIds.length = 0;
    createdActivityIds.length = 0;
  });

  it('returns active users matching the query by default', async () => {
    const requester = await User.create({
      name: 'Requester',
      username: 'requester',
      email: 'requester@example.com',
    });
    currentUser.value = requester;
    createdUserIds.push(requester._id);
    const alice = await User.create({
      name: 'Alice',
      username: 'alice',
      email: 'alice@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
    createdUserIds.push(alice._id);

    const response = await request(app).get('/usernames').query({ q: 'ali' });

    expect(response.status).toBe(200);
    expect(response.body.activeUser.usernames).toContain('alice');
  });

  describe('totalCount', () => {
    // Counting every match cannot stop at `limit` the way the page itself does,
    // so it is opt-in. These two cases pin both halves of that contract.
    const createActiveUsers = async (usernames: string[]) => {
      const users = await Promise.all(
        usernames.map((username) =>
          User.create({
            name: username,
            username,
            email: `${username}@example.com`,
            status: UserStatus.STATUS_ACTIVE,
          }),
        ),
      );
      createdUserIds.push(...users.map((user) => user._id));
    };

    beforeEach(async () => {
      const requester = await User.create({
        name: 'Counter',
        username: 'counter-requester',
        email: 'counter-requester@example.com',
      });
      currentUser.value = requester;
      createdUserIds.push(requester._id);
      await createActiveUsers([
        'countme-1',
        'countme-2',
        'countme-3',
        'countme-4',
      ]);
    });

    it('is omitted, and not even counted, unless requested', async () => {
      // Spied on right before the request so the fixture creation above (which
      // goes through mongoose-unique-validator) cannot be mistaken for the
      // route's own count. Asserting on the query — not just on the response
      // shape — is the point: omitting the field while still counting would
      // leave the whole cost in place.
      const countSpy = vi.spyOn(User, 'countDocuments');

      const response = await request(app)
        .get('/usernames')
        .query({ q: 'countme', limit: 2 });

      expect(response.status).toBe(200);
      // The page is served as before …
      expect(response.body.activeUser.usernames).toHaveLength(2);
      // … but nothing tells the client how many matched in total …
      expect(response.body.activeUser).not.toHaveProperty('totalCount');
      // … and no count was issued to get there.
      expect(countSpy).not.toHaveBeenCalled();

      countSpy.mockRestore();
    });

    it('counts every match, not just the returned page, when requested', async () => {
      const countSpy = vi.spyOn(User, 'countDocuments');

      const response = await request(app)
        .get('/usernames')
        .query({
          q: 'countme',
          limit: 2,
          options: JSON.stringify({ isIncludeTotalCount: true }),
        });

      expect(response.status).toBe(200);
      expect(response.body.activeUser.usernames).toHaveLength(2);
      // 4 created, 2 returned: asserting 4 is what distinguishes a real count
      // from `usernames.length`.
      expect(response.body.activeUser.totalCount).toBe(4);
      // Positive control for the assertion in the case above.
      expect(countSpy).toHaveBeenCalled();

      countSpy.mockRestore();
    });
  });

  describe('offset', () => {
    // `offset` becomes a `skip()`, which walks that many index entries instead of
    // jumping, so an uncapped value is a full scan on request.
    beforeEach(async () => {
      const requester = await User.create({
        name: 'Offset',
        username: 'offset-requester',
        email: 'offset-requester@example.com',
      });
      currentUser.value = requester;
      createdUserIds.push(requester._id);
    });

    // Asserted on the validation code, not merely on the 400: an out-of-range
    // offset that slips past the validator still fails — MongoDB rejects a
    // negative `skip()`, and a huge one just scans — so a bare status assertion
    // passes whether or not the cap exists.
    const expectRejectedByValidation = (response: {
      status: number;
      body: { errors?: { code?: string; message?: string }[] };
    }) => {
      expect(response.status).toBe(400);
      expect(response.body.errors?.[0]?.code).toBe('validation_failed');
      expect(response.body.errors?.[0]?.message).toContain('offset');
    };

    it('rejects an offset beyond the cap', async () => {
      const response = await request(app)
        .get('/usernames')
        .query({ q: 'offset', offset: 1_000_000 });

      expectRejectedByValidation(response);
    });

    it('rejects a negative offset', async () => {
      const response = await request(app)
        .get('/usernames')
        .query({ q: 'offset', offset: -1 });

      expectRejectedByValidation(response);
    });

    it('still accepts an offset at the cap', async () => {
      const response = await request(app)
        .get('/usernames')
        .query({ q: 'offset', offset: 1000 });

      // Past the end of the (tiny) result set, so the page is empty — the point
      // is that a legitimate deep page is not rejected.
      expect(response.status).toBe(200);
      expect(response.body.activeUser.usernames).toEqual([]);
    });
  });

  it('returns inactive users for admins when isIncludeInactiveUser is requested', async () => {
    const requester = await User.create({
      name: 'Requester',
      username: 'requester2',
      email: 'requester2@example.com',
      admin: true,
    });
    currentUser.value = requester;
    createdUserIds.push(requester._id);
    const bob = await User.create({
      name: 'Bob',
      username: 'bob',
      email: 'bob@example.com',
      status: UserStatus.STATUS_SUSPENDED,
    });
    createdUserIds.push(bob._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'bob',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeInactiveUser: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.inactiveUser.usernames).toContain('bob');
  });

  it('classifies a deleted user as inactive rather than dropping them', async () => {
    const requester = await User.create({
      name: 'Requester',
      username: 'requester3',
      email: 'requester3@example.com',
      // Inactive users are admin-only; this case is about the status→group
      // mapping, so it needs the privilege to observe the inactive group at all.
      admin: true,
    });
    currentUser.value = requester;
    createdUserIds.push(requester._id);
    const carol = await User.create({
      name: 'Carol',
      username: 'carol',
      email: 'carol@example.com',
      status: UserStatus.STATUS_DELETED,
    });
    createdUserIds.push(carol._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'carol',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeInactiveUser: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.inactiveUser.usernames).toContain('carol');
  });

  it('does not include inactive users for non-admins even when requested', async () => {
    const regular = await User.create({
      name: 'Regular',
      username: 'regular-user2',
      email: 'regular2@example.com',
      admin: false,
    });
    currentUser.value = regular;
    createdUserIds.push(regular._id);
    const suspended = await User.create({
      name: 'Dave Suspended',
      username: 'dave-suspended',
      email: 'dave-suspended@example.com',
      status: UserStatus.STATUS_SUSPENDED,
    });
    createdUserIds.push(suspended._id);
    const active = await User.create({
      name: 'Dave Active',
      username: 'dave-active',
      email: 'dave-active@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
    createdUserIds.push(active._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'dave',
        options: JSON.stringify({
          isIncludeActiveUser: true,
          isIncludeInactiveUser: true,
        }),
      });

    // Degrades rather than fails: the privileged group is dropped, the rest of
    // the response is still served.
    expect(response.status).toBe(200);
    expect(response.body.inactiveUser).toBeUndefined();
    expect(response.body.activeUser.usernames).toContain('dave-active');
  });

  it('does not leak inactive usernames to non-admins through mixedUsernames', async () => {
    const regular = await User.create({
      name: 'Regular',
      username: 'regular-user3',
      email: 'regular3@example.com',
      admin: false,
    });
    currentUser.value = regular;
    createdUserIds.push(regular._id);
    const suspended = await User.create({
      name: 'Erin Suspended',
      username: 'erin-suspended',
      email: 'erin-suspended@example.com',
      status: UserStatus.STATUS_SUSPENDED,
    });
    createdUserIds.push(suspended._id);
    const active = await User.create({
      name: 'Erin Active',
      username: 'erin-active',
      email: 'erin-active@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
    createdUserIds.push(active._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'erin',
        options: JSON.stringify({
          isIncludeActiveUser: true,
          isIncludeInactiveUser: true,
          // Merges every group it collected into one flat list — the back door
          // that would hand the inactive names over despite the group itself
          // being withheld above.
          isIncludeMixedUsernames: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.mixedUsernames).toContain('erin-active');
    expect(response.body.mixedUsernames).not.toContain('erin-suspended');
  });

  it('refuses a guest outright, disclosing no username', async () => {
    // Every privileged option is requested at once, so the refusal is shown to
    // precede all of them.
    currentUser.value = null;
    const suspended = await User.create({
      name: 'Frank Suspended',
      username: 'frank-suspended',
      email: 'frank-suspended@example.com',
      status: UserStatus.STATUS_SUSPENDED,
    });
    createdUserIds.push(suspended._id);
    const active = await User.create({
      name: 'Frank Active',
      username: 'frank-active',
      email: 'frank-active@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
    createdUserIds.push(active._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'frank',
        options: JSON.stringify({
          isIncludeActiveUser: true,
          isIncludeInactiveUser: true,
          isIncludeActivitySnapshotUser: true,
          isIncludeMixedUsernames: true,
        }),
      });

    expect(response.status).toBe(403);
    // Neither the active nor the suspended account may appear, and no internal
    // error message may be handed back in place of them.
    expect(JSON.stringify(response.body)).not.toContain('frank');
  });

  it('returns activity snapshot usernames for admins', async () => {
    const admin = await User.create({
      name: 'Admin',
      username: 'admin-user',
      email: 'admin@example.com',
      admin: true,
    });
    currentUser.value = admin;
    createdUserIds.push(admin._id);
    const activity = await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      // Avoids collisions on the {user, target, action, createdAt} unique index.
      target: new Types.ObjectId(),
      snapshot: { username: 'ghost-user' },
    });
    createdActivityIds.push(activity._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'ghost',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeActivitySnapshotUser: true,
          // Requested so this case keeps pinning the count value itself.
          isIncludeTotalCount: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.activitySnapshotUser).toEqual({
      usernames: ['ghost-user'],
      totalCount: 1,
    });
  });

  it('does not include activity snapshot usernames for non-admins even when requested', async () => {
    const regular = await User.create({
      name: 'Regular',
      username: 'regular-user',
      email: 'regular@example.com',
      admin: false,
    });
    currentUser.value = regular;
    createdUserIds.push(regular._id);
    const activity = await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      // Avoids collisions on the {user, target, action, createdAt} unique index.
      target: new Types.ObjectId(),
      snapshot: { username: 'ghost-user' },
    });
    createdActivityIds.push(activity._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'ghost',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeActivitySnapshotUser: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.activitySnapshotUser).toBeUndefined();
  });

  it('merges a prefix-matched user list with a substring-matched snapshot list in mixedUsernames', async () => {
    const admin = await User.create({
      name: 'Admin2',
      username: 'thejohnson',
      email: 'admin2@example.com',
      admin: true,
      status: UserStatus.STATUS_ACTIVE,
    });
    currentUser.value = admin;
    createdUserIds.push(admin._id);
    const activity = await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      // Avoids collisions on the {user, target, action, createdAt} unique index.
      target: new Types.ObjectId(),
      snapshot: { username: 'somejohnson' },
    });
    createdActivityIds.push(activity._id);

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'hn',
        options: JSON.stringify({
          isIncludeActiveUser: true,
          isIncludeActivitySnapshotUser: true,
          isIncludeMixedUsernames: true,
        }),
      });

    expect(response.status).toBe(200);
    // "hn" is mid-string in both usernames, so prefix matching misses the user
    // while substring matching still finds the snapshot. Pins the asymmetry.
    expect(response.body.activeUser.usernames).toEqual([]);
    expect(response.body.activitySnapshotUser.usernames).toEqual([
      'somejohnson',
    ]);
    expect(new Set(response.body.mixedUsernames)).toEqual(
      new Set(['somejohnson']),
    );
  });
});
