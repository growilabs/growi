// --- Mock boundary ---------------------------------------------------------
//
// Each route's middleware now lives in its handler factory (get-ai-settings /
// put-ai-settings); this router just mounts the returned RequestHandler[]. So
// this integration test mounts the REAL get/put factories and drives the REAL
// access control under test:
//   - accessTokenParser([SCOPE]) : PAT/scope gate (mocked → records scope, passes through)
//   - loginRequiredFactory(crowi): login gate                — REAL (depends only on req.user)
//   - adminRequiredFactory(crowi): admin gate                — REAL (depends only on req.user)
//   - getAiSettings / putAiSettings terminal handlers        — REAL (deep leaves mocked below)
//   - updateAiSettingsValidators                             — REAL (inline in put-ai-settings; covered in put-ai-settings.spec.ts)
//   - apiV3FormValidator                                     — mocked → passthrough so validation runs but never blocks
//   - generateAddActivityMiddleware()                        — mocked → sets res.locals.activity (PUT)
//
// The observable contract we assert (Req 1.1, 1.2):
//   - an admin reaches the GET handler and the PUT handler (success → status 200)
//   - a logged-in non-admin is REJECTED before the handler runs (non-admin → not 200)
//   - an unauthenticated request to the API path is rejected with 403
//   - the AI admin scope is requested on both routes (the parser receives it)
//   - NO ai-ready / isAiEnabled guard exists — an admin reaches the handler even
//     though no AI config is set, so admins can configure AI while it is disabled (Req 1)
//
// login/admin are NOT mocked: they are the very access control under test. The
// terminal handlers' deep collaborators (configManager, isAiConfigured, the
// resolved-model cache) ARE mocked so the handlers run without touching a real
// DB/model — we only care that an authorized request reaches a 200 success shape.
const { accessTokenParser } = vi.hoisted(() => ({
  accessTokenParser: vi.fn(),
}));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  // Record the requested scope, then pass through (the scope gate itself is tested elsewhere).
  accessTokenParser: (...args: unknown[]) => {
    accessTokenParser(...args);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  },
}));

// updateAiSettingsValidators now lives inline in put-ai-settings.ts and is mounted
// for real by the factory; body validation is covered in put-ai-settings.spec.ts.
// apiV3FormValidator stays a passthrough so validation runs but never blocks → the
// PUT handler is still reached for the valid body this test sends.
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

// Terminal-handler leaves: stub so the REAL handlers run end-to-end without a
// real DB/model. env-only mode is OFF so PUT is not rejected with 422.
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn((k: string) =>
      k === 'env:useOnlyEnvVars:ai' ? false : undefined,
    ),
    updateConfigs: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured: vi.fn(() => false),
}));
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model',
  () => ({ clearResolvedMastraModelCache: vi.fn() }),
);

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
  // The real PUT handler emits an audit event via crowi.events.activity.emit, so
  // provide it (a bare mock<Crowi>() leaves events.activity undefined).
  const crowi = mock<Crowi>({
    events: {
      activity: { emit: vi.fn() } as unknown as Crowi['events']['activity'],
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user != null) {
      // biome-ignore lint/suspicious/noExplicitAny: test seam to attach req.user
      (req as any).user = user;
    }
    next();
  });
  // The REAL terminal handlers call res.apiv3 / res.apiv3Err, which a bare express
  // `res` lacks — stub them so an authorized request yields an observable status.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // biome-ignore lint/suspicious/noExplicitAny: test seam to add apiv3 helpers to res
    (res as any).apiv3 = (data: unknown) => res.status(200).json(data ?? {});
    // biome-ignore lint/suspicious/noExplicitAny: test seam to add apiv3 helpers to res
    (res as any).apiv3Err = (_err: unknown, code = 500) =>
      res.status(code).json({ err: true });
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

  it('requests the AI admin scope and accepts legacy tokens on GET (read) and PUT (write)', () => {
    factory(mock<Crowi>());

    // Each route gates on its AI admin scope AND passes { acceptLegacy: true } so
    // legacy non-scoped admin tokens still authenticate (consistent with the other
    // mastra routes). Assert scope (call[0]) and the option (call[1]) together.
    expect(accessTokenParser).toHaveBeenCalledWith([SCOPE.READ.ADMIN.AI], {
      acceptLegacy: true,
    });
    expect(accessTokenParser).toHaveBeenCalledWith([SCOPE.WRITE.ADMIN.AI], {
      acceptLegacy: true,
    });
  });

  describe('admin user (Req 1.1)', () => {
    const admin: TestUser = { _id: 'u1', status: ACTIVE, admin: true };

    it('reaches the GET handler (success response)', async () => {
      const res = await request(buildApp(admin)).get('/_api/v3/ai-settings/');
      // Real getAiSettings → res.apiv3(response); admins reach the handler.
      // Status 200 is the access-control signal; the response carries the
      // settings shape (isApiKeySet is always a boolean, so it survives JSON).
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('isApiKeySet');
    });

    it('reaches the PUT handler (success response)', async () => {
      const res = await request(buildApp(admin))
        .put('/_api/v3/ai-settings/')
        .send({ aiEnabled: true });
      // Real put handler → res.apiv3({}); env-only mode is off so no 422.
      expect(res.status).toBe(200);
    });
  });

  describe('logged-in non-admin user (Req 1.2)', () => {
    const member: TestUser = { _id: 'u2', status: ACTIVE, admin: false };

    it('is rejected on GET before the handler runs', async () => {
      const res = await request(buildApp(member)).get('/_api/v3/ai-settings/');
      // adminRequired blocks a logged-in non-admin: never the success shape.
      expect(res.status).not.toBe(200);
      expect(res.body).not.toHaveProperty('isApiKeySet');
    });

    it('is rejected on PUT before the handler runs', async () => {
      const res = await request(buildApp(member))
        .put('/_api/v3/ai-settings/')
        .send({ aiEnabled: true });
      expect(res.status).not.toBe(200);
    });
  });

  describe('unauthenticated request (Req 1.2)', () => {
    it('is rejected with 403 on GET (API path), handler not reached', async () => {
      const res = await request(buildApp()).get('/_api/v3/ai-settings/');
      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('isApiKeySet');
    });
  });

  it('reaches the handler even when no AI config is set (no ai-ready guard) (Req 1)', async () => {
    // isAiConfigured() is mocked to false: the admin router must not gate on AI
    // availability, so an admin still reaches the handler (200) regardless of AI state.
    const admin: TestUser = { _id: 'u1', status: ACTIVE, admin: true };
    const res = await request(buildApp(admin)).get('/_api/v3/ai-settings/');
    expect(res.status).toBe(200);
  });
});
