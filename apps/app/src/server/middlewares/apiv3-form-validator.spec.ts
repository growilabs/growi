import express from 'express';
import { body } from 'express-validator';
import request from 'supertest';

import addCustomFunctionToResponse from '../routes/apiv3/response';
import { apiV3FormValidator } from './apiv3-form-validator';

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: () => logger,
}));

const REJECTED_VALUE = 'secret-rejected-input-1234567890';

const buildApp = () => {
  addCustomFunctionToResponse(express);
  const app = express();
  app.use(express.json());
  app.post(
    '/target',
    body('message').isLength({ max: 10 }).withMessage('too long'),
    apiV3FormValidator,
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  return app;
};

const loggedTextAt = (level: 'error' | 'warn' | 'info'): readonly string[] =>
  logger[level].mock.calls.map((args) => JSON.stringify(args));

describe('apiV3FormValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a valid request through to the handler', async () => {
    const res = await request(buildApp())
      .post('/target')
      .send({ message: 'short' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects an invalid request with validation_failed naming the field', async () => {
    const res = await request(buildApp())
      .post('/target')
      .send({ message: REJECTED_VALUE });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({
        code: 'validation_failed',
        message: 'message: too long',
      }),
    ]);
  });

  it('logs the failing field and reason without the rejected value', async () => {
    await request(buildApp()).post('/target').send({ message: REJECTED_VALUE });

    const errorLines = loggedTextAt('error');
    expect(errorLines.join('\n')).toContain('message');
    expect(errorLines.join('\n')).toContain('too long');
    for (const level of ['error', 'warn', 'info'] as const) {
      for (const line of loggedTextAt(level)) {
        expect(line).not.toContain(REJECTED_VALUE);
      }
    }
  });
});
