import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import { GrowiPlugin } from '~/features/growi-plugin/server/models';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { setup } from './customize-setting';

type TestUser = { _id: string; admin: boolean };

const nonAdminUser: TestUser = {
  _id: '6561b2b2b2b2b2b2b2b2b2b2',
  admin: false,
};

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/utils/prisma', () => ({
  prisma: { attachments: { findMany: vi.fn() } },
}));

vi.mock('~/features/growi-plugin/server/models', () => ({
  GrowiPlugin: { findEnabledPluginsByType: vi.fn() },
}));

// The router is a module-level singleton, so it is set up only once
const crowi = mockDeep<Crowi>();
// multer writes uploads under `${crowi.tmpDir}uploads`, so the trailing separator matters
const tmpDir = mkdtempSync(path.join(tmpdir(), 'customize-setting-spec-'));
crowi.tmpDir = `${tmpDir}${path.sep}`;
const router = setup(crowi);

const buildApp = (user: TestUser) => {
  const app = express();
  app.use((req: Request & { user?: TestUser }, res, next) => {
    req.user = user;
    (res as ApiV3Response).apiv3 = (body: unknown, status = 200) =>
      res.status(status).json(body);
    (res as ApiV3Response).apiv3Err = (errors: unknown, status = 400) =>
      res.status(status).json({ errors });
    next();
  });
  app.use('/customize-setting', router);
  return app;
};

describe('customize-setting routes for a non-admin user', () => {
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves GET /theme so that page history can resolve the diff color scheme', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue('default');
    vi.mocked(GrowiPlugin.findEnabledPluginsByType).mockResolvedValue([]);
    const app = buildApp(nonAdminUser);

    const res = await request(app).get('/customize-setting/theme');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currentTheme: 'default',
      pluginThemesMetadatas: [],
    });
  });

  it('does not replace the brand logo via POST /upload-brand-logo', async () => {
    const app = buildApp(nonAdminUser);

    const res = await request(app)
      .post('/customize-setting/upload-brand-logo')
      .attach('file', Buffer.from('fake-image'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(302);
    expect(prisma.attachments.findMany).not.toHaveBeenCalled();
    expect(crowi.attachmentService.createAttachment).not.toHaveBeenCalled();
  });
});
