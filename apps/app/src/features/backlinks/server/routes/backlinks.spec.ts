import { SCOPE } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';

import type { IBacklink } from '../../interfaces/backlink';
import type { PageLinkService } from '../services/page-link-service';

type Viewer = NonNullable<CrowiRequest['user']>;

// The auth middlewares are replaced with passthroughs so the request-handling tests below
// exercise this endpoint rather than the shared auth stack (which has its own specs).
// They stay spies because the factory's other job — which auth the chain demands —
// is only observable through the arguments it hands them (see 'authorization wiring').
const mocks = vi.hoisted(() => {
  const passthrough = (_req: Request, _res: Response, next: NextFunction) =>
    next();
  return {
    accessTokenParser: vi.fn(() => passthrough),
    loginRequiredFactory: vi.fn(() => passthrough),
  };
});

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: mocks.accessTokenParser,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: mocks.loginRequiredFactory,
}));

// Imported after the middleware mocks so the route picks up the passthroughs.
import { getBacklinksHandlerFactory } from './backlinks';

/*
 * B1.13 — the read endpoint is reachable over HTTP.
 * Contract (design.md § Read flow; requirements 1.1, 1.7): GET /_api/v3/page/backlinks
 * validates pageId, delegates to PageLinkService.findBacklinks for the requesting viewer,
 * and answers with { backlinks: IBacklink[] }.
 * Permission filtering itself is the service's contract — see page-link-service.integ.ts.
 */
describe('GET /page/backlinks', () => {
  const validPageId = '507f1f77bcf86cd799439011';

  const findBacklinks = vi.fn<PageLinkService['findBacklinks']>();

  beforeAll(async () => {
    // Install the real res.apiv3 / res.apiv3Err helpers (as server/routes/apiv3/index.js does)
    // so the asserted status codes and error shape are the production ones, not a test stand-in.
    // WHY the cast: response.js is an untyped CommonJS module (`module.exports = fn`),
    // so TypeScript sees no default export even though the ESM interop provides one.
    const responseModule = (await import(
      '~/server/routes/apiv3/response'
    )) as unknown as { default: (e: typeof express) => void };
    responseModule.default(express);
  });

  const buildApp = (viewer?: Viewer) => {
    const crowi = mock<Crowi>({ pageLinkService: { findBacklinks } });

    const app = express();

    // A guest request leaves req.user undefined.
    app.use((req: CrowiRequest, _res, next) => {
      req.user = viewer;
      next();
    });

    // Mirrors the registration in server/routes/apiv3/index.js
    const pageRouter = express.Router();
    pageRouter.get('/backlinks', getBacklinksHandlerFactory(crowi));
    app.use('/page', pageRouter);

    return app;
  };

  const get = (app: express.Application, query?: Record<string, string>) =>
    request(app)
      .get('/page/backlinks')
      .query(query ?? {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('success', () => {
    it('answers 200 with the backlinks returned by the service', async () => {
      const backlinks: IBacklink[] = [
        { pageId: '507f1f77bcf86cd799439021', path: '/source-a' },
        { pageId: '507f1f77bcf86cd799439022', path: '/source-b' },
      ];
      findBacklinks.mockResolvedValue(backlinks);

      const res = await get(buildApp(), { pageId: validPageId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ backlinks });
    });

    it('answers 200 with an empty list when the page has no backlinks (1.7)', async () => {
      findBacklinks.mockResolvedValue([]);

      const res = await get(buildApp(), { pageId: validPageId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ backlinks: [] });
    });

    it('asks the service about the page the client named', async () => {
      findBacklinks.mockResolvedValue([]);

      await get(buildApp(), { pageId: validPageId });

      const [toPageId] = findBacklinks.mock.calls[0];
      expect(String(toPageId)).toBe(validPageId);
    });

    it('asks the service on behalf of the authenticated viewer', async () => {
      findBacklinks.mockResolvedValue([]);
      const viewer = mock<Viewer>();

      await get(buildApp(viewer), { pageId: validPageId });

      const [, user] = findBacklinks.mock.calls[0];
      expect(user).toBe(viewer);
    });

    it('substitutes no viewer identity for an unauthenticated request', async () => {
      findBacklinks.mockResolvedValue([]);

      await get(buildApp(), { pageId: validPageId });

      // `?? null` because null and undefined are the same "no viewer" to the grant filter;
      // what must not happen is a guest being served as some user.
      const [, user] = findBacklinks.mock.calls[0];
      expect(user ?? null).toBeNull();
    });
  });

  describe('validation', () => {
    it('answers 400 without querying the service when pageId is missing', async () => {
      const res = await get(buildApp());

      expect(res.status).toBe(400);
      expect(findBacklinks).not.toHaveBeenCalled();
    });

    it('answers 400 without querying the service when pageId is empty', async () => {
      const res = await get(buildApp(), { pageId: '' });

      expect(res.status).toBe(400);
      expect(findBacklinks).not.toHaveBeenCalled();
    });

    it('answers 400 without querying the service when pageId is not a Mongo ID', async () => {
      const res = await get(buildApp(), { pageId: 'not-an-object-id' });

      expect(res.status).toBe(400);
      expect(findBacklinks).not.toHaveBeenCalled();
    });

    // A repeated query param arrives as an array, and isMongoId() validates its members
    // rather than rejecting it — so this is the one input that reaches the handler's
    // typeof check. Without it the array would reach the ObjectId constructor and 500.
    it('answers 400 without querying the service when pageId is repeated', async () => {
      const res = await request(buildApp()).get(
        `/page/backlinks?pageId=${validPageId}&pageId=${validPageId}`,
      );

      expect(res.status).toBe(400);
      expect(findBacklinks).not.toHaveBeenCalled();
    });
  });

  /*
   * Which auth the endpoint demands is decided when the chain is assembled, so it is
   * observable only in what the factory asks of the auth middlewares. Asserted here
   * because a silently widened token scope, or guests being locked out of a public wiki,
   * would otherwise pass every test above.
   */
  describe('authorization wiring', () => {
    it('demands an access token scoped to reading pages', () => {
      buildApp();

      expect(mocks.accessTokenParser).toHaveBeenCalledWith([
        SCOPE.READ.FEATURES.PAGE,
      ]);
    });

    it('admits guests, so backlinks stay readable on a public wiki', () => {
      buildApp();

      expect(mocks.loginRequiredFactory).toHaveBeenCalledWith(
        expect.anything(),
        true,
      );
    });
  });

  describe('error handling', () => {
    it('answers 500 when the service throws', async () => {
      findBacklinks.mockRejectedValue(new Error('unexpected failure'));

      const res = await get(buildApp(), { pageId: validPageId });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('errors');
    });
  });
});
