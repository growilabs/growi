import type { IUserHasId } from '@growi/core';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

// Hoisted mocks must be declared before any imports that depend on them.
const mocks = vi.hoisted(() => {
  return {
    fetchActiveMembersByGroup: vi.fn(),
    getUserRelatedGroups: vi.fn(),
  };
});

vi.mock('~/server/service/user-group/fetch-active-members-by-group', () => ({
  fetchActiveMembersByGroup: mocks.fetchActiveMembersByGroup,
}));

// Bypass accessTokenParser — just call next()
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// loginRequiredStrictly: pass if req.user is set, else send 401
vi.mock('~/server/middlewares/login-required', () => ({
  default:
    () =>
    (
      req: express.Request & { user?: IUserHasId },
      res: { sendStatus: (code: number) => void },
      next: () => void,
    ) => {
      if (req.user == null) {
        res.sendStatus(401);
        return;
      }
      next();
    },
}));

import { getRelatedGroupsMembersHandlerFactory } from './get-related-groups-members';

const buildApp = (user?: IUserHasId) => {
  const app = express();
  app.use(express.json());

  // Attach user to req when provided
  if (user != null) {
    app.use(
      (
        req: express.Request & { user?: IUserHasId },
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.user = user;
        next();
      },
    );
  }

  // Mock Crowi with pageGrantService
  const crowi = mock<Crowi>({
    pageGrantService: {
      getUserRelatedGroups: mocks.getUserRelatedGroups,
    },
  });

  // Register apiv3 / apiv3Err helpers on the response (mimics the real middleware)
  app.use(
    (
      _req: express.Request,
      res: express.Response & {
        apiv3?: (obj: unknown) => void;
        apiv3Err?: (err: unknown) => void;
      },
      next: express.NextFunction,
    ) => {
      res.apiv3 = (obj: unknown) => {
        res.status(200).json(obj);
      };
      res.apiv3Err = (err: unknown) => {
        res.status(500).json({ error: String(err) });
      };
      next();
    },
  );

  app.get(
    '/api/v3/user/related-groups/members',
    getRelatedGroupsMembersHandlerFactory(crowi),
  );

  return app;
};

describe('getRelatedGroupsMembersHandlerFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unauthenticated request', () => {
    it('should return 401 when user is not logged in (req 3.1)', async () => {
      const app = buildApp(/* no user */);
      const res = await request(app).get('/api/v3/user/related-groups/members');
      expect(res.status).toBe(401);
    });
  });

  describe('authenticated request', () => {
    const mockUser = mock<IUserHasId>({ _id: 'user-id-1', username: 'alice' });

    it('should return 200 and membersByGroupId map for the authenticated user (req 1.1, 2.1, 3.3, 3.5)', async () => {
      const mockGroups = [
        { item: { _id: 'group-1' }, type: 'userGroup' },
        { item: { _id: 'group-2' }, type: 'userGroup' },
      ];
      const mockMembersByGroupId = {
        'group-1': [{ username: 'alice', name: 'Alice' }],
        'group-2': [{ username: 'bob', name: 'Bob' }],
      };

      mocks.getUserRelatedGroups.mockResolvedValue(mockGroups);
      mocks.fetchActiveMembersByGroup.mockResolvedValue(mockMembersByGroupId);

      const app = buildApp(mockUser);
      const res = await request(app).get('/api/v3/user/related-groups/members');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ membersByGroupId: mockMembersByGroupId });
    });

    it('should only contain groups derived from session user — not arbitrary caller-supplied groups (req 3.2)', async () => {
      // The server derives groups from req.user via getUserRelatedGroups,
      // so the response map can only contain keys for those groups.
      const sessionGroups = [
        { item: { _id: 'session-group-only' }, type: 'userGroup' },
      ];
      const sessionMembers = {
        'session-group-only': [{ username: 'alice', name: 'Alice' }],
      };

      mocks.getUserRelatedGroups.mockResolvedValue(sessionGroups);
      mocks.fetchActiveMembersByGroup.mockResolvedValue(sessionMembers);

      const app = buildApp(mockUser);
      const res = await request(app).get('/api/v3/user/related-groups/members');

      expect(res.status).toBe(200);
      // The key 'other-group' cannot appear because getUserRelatedGroups was
      // not called with any attacker-controlled input.
      expect(Object.keys(res.body.membersByGroupId)).toEqual([
        'session-group-only',
      ]);
      // Verify service was called with the session-derived groups
      expect(mocks.fetchActiveMembersByGroup).toHaveBeenCalledWith(
        sessionGroups,
      );
    });

    it('should return empty membersByGroupId when user has no groups', async () => {
      mocks.getUserRelatedGroups.mockResolvedValue([]);
      mocks.fetchActiveMembersByGroup.mockResolvedValue({});

      const app = buildApp(mockUser);
      const res = await request(app).get('/api/v3/user/related-groups/members');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ membersByGroupId: {} });
    });

    it('should return 500 when getUserRelatedGroups rejects (error path)', async () => {
      mocks.getUserRelatedGroups.mockRejectedValue(new Error('db failure'));

      const app = buildApp(mockUser);
      const res = await request(app).get('/api/v3/user/related-groups/members');

      expect(res.status).toBe(500);
    });
  });
});
