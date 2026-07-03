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
//   - generateAddActivityMiddleware()                        — mocked → sets res.locals.activity (PUT / POST refresh)
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

// updateAiSettingsValidators (PUT) and getAvailableModelsValidators (GET
// /available-models) live in their handler factories and are mounted for real.
// apiV3FormValidator is deliberately NOT mocked here so the real validator chain
// enforces end-to-end: the PUT body this test sends is valid (reaches the
// handler), while an invalid `?provider` on /available-models is turned into a
// 400 by the real middleware rather than reaching the handler.
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
// No refreshed catalog persisted (getSingleton → null): the REAL
// available-models handler falls back to the bundled committed asset, keeping
// these cases DB-free while still exercising the real catalog read (Req 9.5).
// Mocking '~/utils/prisma' also prevents the real PrismaClient from being
// instantiated in this unit suite.
vi.mock('~/utils/prisma', () => ({
  prisma: {
    mastrarefreshedmodelcatalogs: {
      getSingleton: vi.fn(async () => null),
      upsertSingleton: vi.fn(),
    },
  },
}));
// The POST /refresh-model-catalog terminal handler's collaborator: mocked so
// the route never fetches models.dev in tests; per-test overrides drive the
// success/failure shapes.
const { refreshModelCatalog } = vi.hoisted(() => ({
  refreshModelCatalog: vi.fn(),
}));
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/refresh-model-catalog',
  () => ({ refreshModelCatalog }),
);

import { SCOPE } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';

import { factory } from './index';

type TestUser = { _id: string; status: number; admin: boolean };

const ACTIVE = 2; // UserStatus.STATUS_ACTIVE

// Build an app that injects `user` (or none) before the router, then mounts the
// factory under a `/_api/v3`-style base so login-required treats it as an API path
// (responds 403 rather than redirecting when unauthenticated).
// Shared across buildApp instances so tests can assert the audit emit of the
// mutation handlers (PUT / POST refresh); cleared by the beforeEach below.
const activityEmitMock = vi.fn();

const buildApp = (user?: TestUser) => {
  // The real PUT / POST refresh handlers emit an audit event via
  // crowi.events.activity.emit, so provide it (a bare mock<Crowi>() leaves
  // events.activity undefined).
  const crowi = mock<Crowi>({
    events: {
      activity: {
        emit: activityEmitMock,
      } as unknown as Crowi['events']['activity'],
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
    // Default code 400 mirrors the real express.response.apiv3Err default, so the
    // real apiV3FormValidator (which calls apiv3Err with no explicit code on a
    // validation failure) yields a 400 here.
    // biome-ignore lint/suspicious/noExplicitAny: test seam to add apiv3 helpers to res
    (res as any).apiv3Err = (_err: unknown, code = 400) =>
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

  // GET /available-models drives the SAME access control as GET/PUT, plus the real
  // offline catalog lookup (no DB/config dependency, so nothing extra is mocked).
  describe('GET /available-models', () => {
    const admin: TestUser = { _id: 'u1', status: ACTIVE, admin: true };
    const member: TestUser = { _id: 'u2', status: ACTIVE, admin: false };

    it('requests the AI admin READ scope (accepts legacy) for the route', () => {
      factory(mock<Crowi>());
      expect(accessTokenParser).toHaveBeenCalledWith([SCOPE.READ.ADMIN.AI], {
        acceptLegacy: true,
      });
    });

    it('returns a non-empty modelIds list for an admin with ?provider=openai (Req 1.1)', async () => {
      const res = await request(buildApp(admin)).get(
        '/_api/v3/ai-settings/available-models?provider=openai',
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.modelIds)).toBe(true);
      expect(res.body.modelIds.length).toBeGreaterThan(0);
      // The response carries only model-id info — no secret-bearing fields (Req 7.1).
      expect(res.body).not.toHaveProperty('apiKey');
      expect(res.body).not.toHaveProperty('providerOptions');
    });

    it('returns { modelIds: [] } for an admin with ?provider=azure-openai (Req 3.1)', async () => {
      const res = await request(buildApp(admin)).get(
        '/_api/v3/ai-settings/available-models?provider=azure-openai',
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ modelIds: [] });
    });

    it('rejects an invalid provider with 400 (Req input validation)', async () => {
      const res = await request(buildApp(admin)).get(
        '/_api/v3/ai-settings/available-models?provider=bogus',
      );
      expect(res.status).toBe(400);
      expect(res.body).not.toHaveProperty('modelIds');
    });

    it('rejects a missing provider with 400 (Req input validation)', async () => {
      const res = await request(buildApp(admin)).get(
        '/_api/v3/ai-settings/available-models',
      );
      expect(res.status).toBe(400);
      expect(res.body).not.toHaveProperty('modelIds');
    });

    it('rejects a logged-in non-admin before the handler runs (Req 7.2)', async () => {
      const res = await request(buildApp(member)).get(
        '/_api/v3/ai-settings/available-models?provider=openai',
      );
      // adminRequired blocks the non-admin: never the success shape.
      expect(res.status).not.toBe(200);
      expect(res.body).not.toHaveProperty('modelIds');
    });

    it('rejects an unauthenticated request with 403 (API path), handler not reached (Req 7.2)', async () => {
      const res = await request(buildApp()).get(
        '/_api/v3/ai-settings/available-models?provider=openai',
      );
      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('modelIds');
    });
  });

  // POST /refresh-model-catalog drives the SAME access control (WRITE scope +
  // login + admin); the refresh service itself is mocked (never fetches here).
  describe('POST /refresh-model-catalog (Req 9.1, 9.7)', () => {
    const admin: TestUser = { _id: 'u1', status: ACTIVE, admin: true };
    const member: TestUser = { _id: 'u2', status: ACTIVE, admin: false };

    it('requests the AI admin WRITE scope (accepts legacy) for the route', () => {
      factory(mock<Crowi>());
      expect(accessTokenParser).toHaveBeenCalledWith([SCOPE.WRITE.ADMIN.AI], {
        acceptLegacy: true,
      });
    });

    it('refreshes and answers metadata only for an admin (Req 9.1, 7.1)', async () => {
      const fetchedAt = new Date('2026-07-02T00:00:00.000Z');
      refreshModelCatalog.mockResolvedValue({
        models: { openai: ['gpt-4o'], anthropic: ['claude'], google: ['g'] },
        fetchedAt,
      });

      const res = await request(buildApp(admin)).post(
        '/_api/v3/ai-settings/refresh-model-catalog',
      );

      expect(res.status).toBe(200);
      expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
      // Metadata only: timestamp + per-provider counts, no ids and no secrets.
      expect(res.body).toEqual({
        fetchedAt: fetchedAt.toISOString(),
        counts: { openai: 1, anthropic: 1, google: 1 },
      });
      // Audit trail: the successful refresh settles the Activity created by
      // addActivity, so operators can attribute who refreshed the catalog.
      expect(activityEmitMock).toHaveBeenCalledWith('update', 'activity-id', {
        action: SupportedAction.ACTION_ADMIN_AI_MODEL_CATALOG_REFRESH,
      });
    });

    it('answers a generic 500 when the refresh fails, without leaking internals (Req 9.4)', async () => {
      refreshModelCatalog.mockRejectedValue(
        new Error('fetch failed: 503 for https://models.dev/api.json'),
      );

      const res = await request(buildApp(admin)).post(
        '/_api/v3/ai-settings/refresh-model-catalog',
      );

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('models.dev');
      // A failed refresh must not settle the audit Activity (nothing changed).
      expect(activityEmitMock).not.toHaveBeenCalled();
    });

    it('rejects a logged-in non-admin before the handler runs (Req 9.7)', async () => {
      const res = await request(buildApp(member)).post(
        '/_api/v3/ai-settings/refresh-model-catalog',
      );
      expect(res.status).not.toBe(200);
      expect(refreshModelCatalog).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 403, handler not reached (Req 9.7)', async () => {
      const res = await request(buildApp()).post(
        '/_api/v3/ai-settings/refresh-model-catalog',
      );
      expect(res.status).toBe(403);
      expect(refreshModelCatalog).not.toHaveBeenCalled();
    });
  });
});
