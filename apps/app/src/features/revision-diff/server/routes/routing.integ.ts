/**
 * Routing regression integration tests for the revision-diff feature.
 *
 * Goal: prove that `GET /revisions/changes` is NOT swallowed by the legacy
 * `/:id([0-9a-fA-F]{24})` route, exercising the REAL changes route factory (not a stub),
 * in the same route-registration order as production.
 *
 * Production wiring (apps/app/src/server/routes/apiv3/index.js + revisions.js):
 *   revisionsRouter.get('/:id([0-9a-fA-F]{24})', <legacy handler>);  // registered first (revisions.js)
 *   revisionsRouter.get('/changes', changesRouteHandlersFactory(crowi)); // appended (index.js)
 *   router.use('/revisions', revisionsRouter);
 *
 * The legacy `revisions.js` router cannot be imported under vitest (it is a CommonJS module
 * whose nested `require('~/…')` escapes the alias transform), so the `/:id` slot here is a
 * lightweight probe that mirrors the production constraint string. To keep that mirror honest,
 * a drift-guard test reads revisions.js and asserts the exact constraint literal still exists —
 * so loosening/removing it in revisions.js fails this suite.
 *
 * Requirements: 1.1, 8.1
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type Crowi from '~/server/crowi';
import { Revision } from '~/server/models/revision';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { changesRouteHandlersFactory } from './changes';

// ---------------------------------------------------------------------------
// Bypass auth/validation middleware that the real changes factory pulls in.
// ---------------------------------------------------------------------------

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('~/server/middlewares/apiv3-form-validator', () => ({
  apiV3FormValidator: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

// The real changes factory reads the lookback-limit config; stub it (config is not
// loaded in this test) so GET /revisions/changes reaches the handler.
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn().mockReturnValue(31536000) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeId = (): Types.ObjectId => new Types.ObjectId();

/** The production constraint string from revisions.js, mirrored here and drift-guarded below. */
const LEGACY_ID_ROUTE = '/:id([0-9a-fA-F]{24})';

/** Minimal Crowi — the changes factory only calls loginRequiredFactory(crowi, false). */
function buildCrowi(): Crowi {
  return {} as unknown as Crowi;
}

/**
 * Build an Express app mirroring the production registration order: the constrained
 * legacy `/:id` route first (as revisions.js registers it), then the REAL changes route
 * appended afterwards (as index.js does). The legacy slot is a probe; the changes slot is real.
 */
function buildApp(userId: Types.ObjectId): express.Express {
  const app = express();
  app.use(express.json());

  // apiv3 response helpers.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    (res as ApiV3Response).apiv3 = (body: unknown, status = 200) =>
      res.status(status).json(body);
    (res as ApiV3Response).apiv3Err = (err: unknown, status = 500) => {
      const errors = Array.isArray(err) ? err : [err];
      return res.status(status).json({ errors });
    };
    next();
  });

  // Inject the authenticated user.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: IUserHasId }).user = {
      _id: userId,
      admin: false,
    } as unknown as IUserHasId;
    next();
  });

  const revRouter = express.Router();
  // Registered first, exactly like revisions.js — the constraint must reject "changes".
  revRouter.get(LEGACY_ID_ROUTE, (req: Request, res: Response) => {
    res.status(200).json({ handler: 'legacy-id', id: req.params.id });
  });
  // Appended afterwards, exactly like index.js — uses the REAL changes factory.
  revRouter.get('/changes', changesRouteHandlersFactory(buildCrowi()));
  app.use('/revisions', revRouter);

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Revision routing — /:id([0-9a-fA-F]{24}) constraint vs /changes', () => {
  beforeEach(async () => {
    await Revision.deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Core regression (Req 1.1): "changes" contains non-hex chars, so it must NOT match
   * the legacy /:id route and must reach the REAL changes handler, which returns
   * { changes, next } (an empty list against an empty DB).
   */
  it('GET /revisions/changes reaches the real changes handler (not swallowed by /:id)', async () => {
    const res = await request(buildApp(makeId())).get('/revisions/changes');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.changes)).toBe(true);
    expect(res.body).toHaveProperty('next');
    // Must NOT have hit the legacy /:id probe.
    expect(res.body).not.toHaveProperty('handler');
  });

  /** Positive case (Req 8.1): a 24-hex string matches the legacy /:id route. */
  it('GET /revisions/<24-hex> matches the legacy /:id route', async () => {
    const validHex = '507f1f77bcf86cd799439011';
    const res = await request(buildApp(makeId())).get(`/revisions/${validHex}`);

    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('legacy-id');
    expect(res.body.id).toBe(validHex);
  });

  /** Upper-case hex is also valid for the constraint. */
  it('GET /revisions/<24-hex uppercase> matches the legacy /:id route', async () => {
    const upperHex = 'ABCDEFABCDEFABCDEFABCDEF';
    const res = await request(buildApp(makeId())).get(`/revisions/${upperHex}`);

    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('legacy-id');
    expect(res.body.id).toBe(upperHex);
  });

  /** A short non-hex string matches no route → Express default 404. */
  it('GET /revisions/<non-hex> matches no route and returns 404', async () => {
    const res = await request(buildApp(makeId())).get('/revisions/notvalid');

    expect(res.status).toBe(404);
  });

  /** 24 chars but containing non-hex digits must not match the constraint → 404. */
  it('GET /revisions/<24-char non-hex> does not match /:id and returns 404', async () => {
    const nonHex24 = 'gggggggggggggggggggggggg';
    const res = await request(buildApp(makeId())).get(`/revisions/${nonHex24}`);

    expect(res.status).toBe(404);
  });

  /**
   * Drift guard: the probe above mirrors the constraint from revisions.js. This asserts the
   * real source still carries the exact literal, so weakening it there fails this suite.
   */
  it('revisions.js still constrains the legacy /:id route to 24 hex chars', () => {
    const revisionsSrc = readFileSync(
      path.resolve(process.cwd(), 'src/server/routes/apiv3/revisions.js'),
      'utf8',
    );
    expect(revisionsSrc).toContain(LEGACY_ID_ROUTE);
  });
});
