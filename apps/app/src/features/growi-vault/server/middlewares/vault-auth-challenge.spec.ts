import type { Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultActivityRecorder } from '../interfaces/vault-activity-recorder';
import { createVaultAuthChallenge } from './vault-auth-challenge';

const { warnLog } = vi.hoisted(() => ({ warnLog: vi.fn() }));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnLog,
    error: vi.fn(),
  }),
}));

const buildApp = (
  handler: (req: Request, res: Response) => void,
): express.Express => {
  const app = express();
  app.get('/vault.git/info/refs', handler);
  return app;
};

describe('createVaultAuthChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers 401 with the git Basic challenge and an empty body, and records VAULT_AUTH_FAILURE', async () => {
    const recordActivity = vi
      .fn<VaultActivityRecorder>()
      .mockResolvedValue(undefined);
    const app = buildApp(createVaultAuthChallenge(recordActivity));

    const res = await request(app).get(
      '/vault.git/info/refs?service=git-upload-pack',
    );

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="GROWI Vault"');
    expect(res.text).toBe('');
    expect(recordActivity).toHaveBeenCalledExactlyOnceWith({
      ip: expect.any(String),
      endpoint: '/vault.git/info/refs?service=git-upload-pack',
      action: 'VAULT_AUTH_FAILURE',
      user: undefined,
      snapshot: {},
    });
  });

  it('still answers 401 and logs a warning when recording the audit record fails', async () => {
    const auditError = new Error('activity store unavailable');
    const recordActivity = vi
      .fn<VaultActivityRecorder>()
      .mockRejectedValue(auditError);
    const app = buildApp(createVaultAuthChallenge(recordActivity));

    const res = await request(app).get('/vault.git/info/refs');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="GROWI Vault"');
    expect(warnLog).toHaveBeenCalledWith(
      { err: auditError },
      'Failed to record auth-failure activity',
    );
  });
});
