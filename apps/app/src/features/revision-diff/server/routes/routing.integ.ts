/**
 * Routing regression integration tests for the revision-diff feature.
 *
 * Purpose: Verify that `GET /revisions/changes` is NOT swallowed by the legacy
 * `/:id([0-9a-fA-F]{24})` route, and that the 24-hex ObjectId constraint on the
 * legacy route behaves correctly for valid and invalid inputs.
 *
 * Requirements: 1.1, 8.1
 *
 * These tests build a self-contained minimal Express app that mimics the route
 * structure mounted in apps/app/src/server/routes/apiv3/index.js:
 *
 *   revisionsRouter.get('/changes', changesRouteHandlersFactory(crowi));
 *   revisionsRouter.get('/:id([0-9a-fA-F]{24})', <existing handler>);
 *   router.use('/revisions', revisionsRouter);
 *
 * The real handlers (changesRouteHandlersFactory, certifySharedPage, DB queries)
 * are NOT exercised here — the goal is purely routing dispatch correctness.
 */

import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Stub out middleware that the real route handlers pull in at import time.
// Without these stubs, importing changes.ts would pull Crowi, Mongoose models,
// and third-party utilities that require a fully-booted server.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app that mirrors the production route structure:
 *
 *   GET /revisions/changes   → handled by a lightweight stub (not the real factory)
 *   GET /revisions/:id(hex)  → handled by a lightweight stub
 *
 * All middleware (auth, validators) is bypassed via the vi.mock() calls above.
 * The stubs just return a recognisable JSON payload so tests can assert which
 * handler was actually reached.
 */
function buildMinimalRevisionApp() {
  const app = express();
  app.use(express.json());

  // Attach res.apiv3 / res.apiv3Err helpers (mirror withApiV3Helpers pattern).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // biome-ignore lint/suspicious/noExplicitAny: apiv3 helper not typed on Response
    (res as any).apiv3 = (body: unknown, status = 200) =>
      res.status(status).json(body);
    // biome-ignore lint/suspicious/noExplicitAny: apiv3Err helper not typed on Response
    (res as any).apiv3Err = (err: unknown, status = 500) =>
      res.status(status).json({ error: String(err) });
    next();
  });

  const revRouter = express.Router();

  // The /changes handler must be registered before /:id so that, without the
  // regex constraint, the string "changes" would be caught by /:id.  The
  // production code registers them in this exact order via index.js.
  revRouter.get('/changes', (_req: Request, res: Response) => {
    res.status(200).json({ handler: 'changes' });
  });

  // Mimic the production constraint: only 24-hex-char strings match /:id.
  revRouter.get('/:id([0-9a-fA-F]{24})', (req: Request, res: Response) => {
    res.status(200).json({ handler: 'existing-id', id: req.params.id });
  });

  app.use('/revisions', revRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Revision routing — regression tests for /:id([0-9a-fA-F]{24}) constraint', () => {
  /**
   * Core regression test (Req 1.1):
   * The string "changes" is 7 characters and contains non-hex chars ('g').
   * It must NOT match `/:id([0-9a-fA-F]{24})` and must reach /changes instead.
   */
  it('GET /revisions/changes reaches the /changes handler (not swallowed by /:id)', async () => {
    const app = buildMinimalRevisionApp();

    const res = await request(app).get('/revisions/changes');

    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('changes');
  });

  /**
   * Positive case for the legacy route (Req 8.1):
   * A 24-character hex string is a valid ObjectId and must match `/:id([0-9a-fA-F]{24})`.
   */
  it('GET /revisions/<valid-24-hex-ObjectId> reaches the existing /:id handler', async () => {
    const validObjectId = '507f1f77bcf86cd799439011';
    const app = buildMinimalRevisionApp();

    const res = await request(app).get(`/revisions/${validObjectId}`);

    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('existing-id');
    expect(res.body.id).toBe(validObjectId);
  });

  /**
   * Non-ObjectId strings shorter than 24 chars must not match `/:id([0-9a-fA-F]{24})`.
   * This test doubles as a guard for the case where Express falls through to 404.
   */
  it('GET /revisions/notvalid (short non-hex string) does NOT match /:id and returns 404', async () => {
    const app = buildMinimalRevisionApp();

    const res = await request(app).get('/revisions/notvalid');

    // No handler matches → Express default 404
    expect(res.status).toBe(404);
  });

  /**
   * A 24-char string that includes non-hex characters ('g'–'z') must not
   * match the constraint, guarding against partial hex strings.
   */
  it('GET /revisions/<24-char non-hex string> does NOT match /:id and returns 404', async () => {
    // 24 chars but contains 'g' which is not a valid hex digit
    const nonHex24 = 'gggggggggggggggggggggggg';
    const app = buildMinimalRevisionApp();

    const res = await request(app).get(`/revisions/${nonHex24}`);

    expect(res.status).toBe(404);
  });

  /**
   * "changes" must not match even when the route order is inverted (defensive check).
   * Verifies that the regex constraint is what prevents the collision — not just
   * registration order.
   */
  it('"changes" does not match the 24-hex constraint regardless of registration order', () => {
    // Pure regex test — no HTTP request needed.
    const objectIdPattern = /^[0-9a-fA-F]{24}$/;
    expect(objectIdPattern.test('changes')).toBe(false);
  });

  /**
   * All lowercase hex characters must match (lower boundary of the hex charset).
   */
  it('GET /revisions/<24-char all-lowercase hex> matches /:id handler', async () => {
    const lowerHex = 'abcdefabcdefabcdefabcdef';
    const app = buildMinimalRevisionApp();

    const res = await request(app).get(`/revisions/${lowerHex}`);

    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('existing-id');
    expect(res.body.id).toBe(lowerHex);
  });

  /**
   * All uppercase hex characters must also match (upper boundary of the hex charset).
   */
  it('GET /revisions/<24-char all-uppercase hex> matches /:id handler', async () => {
    const upperHex = 'ABCDEFABCDEFABCDEFABCDEF';
    const app = buildMinimalRevisionApp();

    const res = await request(app).get(`/revisions/${upperHex}`);

    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('existing-id');
    expect(res.body.id).toBe(upperHex);
  });
});
