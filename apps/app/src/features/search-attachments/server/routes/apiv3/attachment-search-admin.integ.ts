/**
 * The audit record of PUT /_api/v3/admin/attachment-search/config through the
 * factory's real chain and the real activity service on MongoDB. The search
 * service and the attachment index are mocks, so no Elasticsearch index is
 * created.
 */

import type { IUserHasId } from '@growi/core';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import type SearchService from '~/server/service/search';
import { prisma } from '~/utils/prisma';

import type { AttachmentIndexOperations } from '../../services/attachment-search-delegator-extension';
import { attachmentSearchAdminFactory } from './attachment-search-admin';

const RUN = `${process.env.VITEST_WORKER_ID ?? '1'}-${Date.now()}`;
const MOUNT = '/_api/v3/admin/attachment-search';
const ENDPOINT = `${MOUNT}/config`;
const TOKEN = `extractor-token-${RUN}`;

describe('PUT /_api/v3/admin/attachment-search/config audit record', () => {
  let crowi: Crowi;
  let app: express.Express;
  let admin: IUserHasId;
  let originalSearchService: Crowi['searchService'];
  let originalIndexOperations: Crowi['attachmentIndexOperations'];

  const put = (body: Record<string, unknown>) =>
    request(app).put(ENDPOINT).send(body);

  const activities = () =>
    prisma.activities.findMany({ where: { endpoint: ENDPOINT } });

  beforeAll(async () => {
    crowi = await getInstance();
    addCustomFunctionToResponse(express);

    const originalGetConfig = configManager.getConfig.bind(configManager);
    vi.spyOn(configManager, 'getConfig').mockImplementation((key, source) => {
      // The settings action belongs to the large audit-log group
      if (key === 'app:auditLogEnabled') return true;
      if (key === 'app:auditLogActionGroupSize') return ActionGroupSize.Large;
      return originalGetConfig(key, source);
    });

    originalSearchService = crowi.searchService;
    originalIndexOperations = crowi.attachmentIndexOperations;
    crowi.searchService = mock<SearchService>({ isConfigured: true });
    crowi.attachmentIndexOperations = mock<AttachmentIndexOperations>();

    const username = `attachment-search-admin-${RUN}`;
    admin = await crowi.models.User.create({
      name: username,
      username,
      email: `${username}@example.com`,
      admin: true,
    });

    app = express();
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
      req.user = admin;
      next();
    });
    app.use(MOUNT, attachmentSearchAdminFactory(crowi));
  }, 60_000);

  afterEach(async () => {
    await prisma.activities.deleteMany({ where: { endpoint: ENDPOINT } });
  });

  afterAll(async () => {
    await put({ extractorUri: null, extractorToken: null });
    await prisma.activities.deleteMany({ where: { endpoint: ENDPOINT } });
    await crowi.models.User.deleteMany({ _id: admin._id });
    crowi.searchService = originalSearchService;
    crowi.attachmentIndexOperations = originalIndexOperations;
    vi.restoreAllMocks();
  }, 30_000);

  it('records the settings update with its operator and without the token', async () => {
    const res = await put({
      extractorUri: 'http://extractor.example.com:8000',
      extractorToken: TOKEN,
    });
    expect(res.status).toBe(200);

    const rows = await vi.waitFor(
      async () => {
        const found = await activities();
        expect(found).toEqual([
          expect.objectContaining({
            action:
              SupportedAction.ACTION_ADMIN_ATTACHMENT_SEARCH_SETTINGS_UPDATE,
            userId: admin._id.toString(),
          }),
        ]);
        return found;
      },
      { timeout: 3_000, interval: 50 },
    );
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
  });

  it('records only an unsettled attempt for a refused update', async () => {
    const res = await put({
      extractorUri: 'http://169.254.169.254/latest',
      extractorToken: TOKEN,
    });
    expect(res.status).toBe(400);

    await vi.waitFor(
      async () =>
        expect(await activities()).toEqual([
          expect.objectContaining({
            action: SupportedAction.ACTION_UNSETTLED,
            userId: admin._id.toString(),
          }),
        ]),
      { timeout: 3_000, interval: 50 },
    );
  });
});
