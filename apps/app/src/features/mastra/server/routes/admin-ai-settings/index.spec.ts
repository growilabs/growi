// --- Mock boundary ---------------------------------------------------------
//
// The router factory wires four collaborators onto two routes (GET / and PUT /):
//   - accessTokenParser([SCOPE]) : PAT/scope gate (passes the request through here)
//   - loginRequiredFactory(crowi): login gate                — REAL (depends only on req.user)
//   - adminRequiredFactory(crowi): admin gate                — REAL (depends only on req.user)
//   - getAiSettings / putAiSettingsFactory(crowi)            : terminal handlers
//   - updateAiSettingsValidators / apiV3FormValidator        : PUT body validation
//   - generateAddActivityMiddleware()                        : creates res.locals.activity (PUT)
//
// The observable contract we assert (Req 1.1, 1.2):
//   - an admin reaches the GET handler and the PUT handler (admins can GET/PUT)
//   - a logged-in non-admin is REJECTED before the handler runs (non-admin -> 403)
//   - the AI admin scope is requested on both routes (the parser receives it)
//   - NO ai-ready / isAiEnabled guard exists — the request reaches the handler even
//     though no AI config is set, so admins can configure AI while it is disabled (Req 1)
//
// accessTokenParser and the terminal handlers are mocked so the test exercises this
// router's wiring (scope + admin authorization + handler dispatch), not their internals.
// loginRequired/adminRequired are NOT mocked: they are the very access control under test.
const { accessTokenParser, getAiSettings, putAiSettings } = vi.hoisted(() => ({
  accessTokenParser: vi.fn(),
  getAiSettings: vi.fn(),
  putAiSettings: vi.fn(),
}));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  // Record the requested scope, then pass through (the scope gate itself is tested elsewhere).
  accessTokenParser: (...args: unknown[]) => {
    accessTokenParser(...args);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  },
}));

vi.mock('./get-ai-settings', () => ({
  getAiSettings: (_req: Request, res: Response) => {
    getAiSettings();
    res.status(200).json({ handler: 'get' });
  },
}));

vi.mock('./put-ai-settings', () => ({
  putAiSettingsFactory: () => (_req: Request, res: Response) => {
    putAiSettings();
    res.status(200).json({ handler: 'put' });
  },
}));

// Keep validation a no-op so PUT reaches the handler when authorized; body
// validation is covered by validators.spec.ts.
vi.mock('./validators', () => ({ updateAiSettingsValidators: [] }));
vi.mock('~/server/middlewares/apiv3-form-validator', () => ({
  apiV3FormValidator: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));
vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: 'activity-id' };
      next();
    },
}));

import { SCOPE } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { factory } from './index';

type TestUser = { _id: string; status: number; admin: boolean };

const ACTIVE = 2; // UserStatus.STATUS_ACTIVE

// Build an app that injects `user` (or none) before the router, then mounts the
// factory under a `/_api/v3`-style base so login-required treats it as an API path
// (responds 403 rather than redirecting when unauthenticated).
const buildApp = (user?: TestUser) => {
  const crowi = mock<Crowi>();
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user != null) {
      // biome-ignore lint/suspicious/noExplicitAny: test seam to attach req.user
      (req as any).user = user;
    }
    next();
  });
  app.use('/_api/v3/ai-settings', factory(crowi));
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('admin-ai-settings router factory', () => {
  it('returns an express Router', () => {
    const crowi = mock<Crowi>();
    const router = factory(crowi);
    expect(typeof router).toBe('function');
    expect(router.stack).toBeDefined();
  });

  it('requests the AI admin read scope on GET and write scope on PUT', () => {
    factory(mock<Crowi>());

    const requestedScopes = accessTokenParser.mock.calls.map((call) => call[0]);
    expect(requestedScopes).toContainEqual([SCOPE.READ.ADMIN.AI]);
    expect(requestedScopes).toContainEqual([SCOPE.WRITE.ADMIN.AI]);
  });

  describe('admin user (Req 1.1)', () => {
    const admin: TestUser = { _id: 'u1', status: ACTIVE, admin: true };

    it('reaches the GET handler', async () => {
      const res = await request(buildApp(admin)).get('/_api/v3/ai-settings/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handler: 'get' });
      expect(getAiSettings).toHaveBeenCalledTimes(1);
    });

    it('reaches the PUT handler', async () => {
      const res = await request(buildApp(admin))
        .put('/_api/v3/ai-settings/')
        .send({ aiEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handler: 'put' });
      expect(putAiSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('logged-in non-admin user (Req 1.2)', () => {
    const member: TestUser = { _id: 'u2', status: ACTIVE, admin: false };

    it('is rejected on GET before the handler runs', async () => {
      const res = await request(buildApp(member)).get('/_api/v3/ai-settings/');
      // adminRequired redirects ('/') a logged-in non-admin; never 200, handler not reached
      expect(res.status).not.toBe(200);
      expect(getAiSettings).not.toHaveBeenCalled();
    });

    it('is rejected on PUT before the handler runs', async () => {
      const res = await request(buildApp(member))
        .put('/_api/v3/ai-settings/')
        .send({ aiEnabled: true });
      expect(res.status).not.toBe(200);
      expect(putAiSettings).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated request (Req 1.2)', () => {
    it('is rejected with 403 on GET (API path), handler not reached', async () => {
      const res = await request(buildApp()).get('/_api/v3/ai-settings/');
      expect(res.status).toBe(403);
      expect(getAiSettings).not.toHaveBeenCalled();
    });
  });

  it('reaches the handler even when no AI config is set (no ai-ready guard) (Req 1)', async () => {
    // No isAiEnabled / ai-ready mock is involved: the admin router must not gate on
    // AI availability, so an admin reaches the handler regardless of AI state.
    const admin: TestUser = { _id: 'u1', status: ACTIVE, admin: true };
    const res = await request(buildApp(admin)).get('/_api/v3/ai-settings/');
    expect(res.status).toBe(200);
  });
});
