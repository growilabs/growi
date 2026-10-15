import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import { ConfigLoader } from '~/server/service/config-manager/config-loader';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

const { bulkWrite } = vi.hoisted(() => ({ bulkWrite: vi.fn() }));
vi.mock('~/server/models/config', () => ({ Config: { bulkWrite } }));
const passthrough = (_req: Request, _res: Response, next: NextFunction) =>
  next();
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthrough,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthrough,
}));
vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthrough,
}));
vi.mock('../../../middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: '507f1f77bcf86cd799439011' };
      next();
    },
}));

const cases = [
  {
    provider: 'aws',
    flag: 'AWS',
    payload: {
      s3Bucket: 'owned-bucket',
      s3Region: 'us-east-1',
      s3CustomEndpoint: 'https://owned.example',
      s3AccessKeyId: 'ownedkey',
      s3SecretAccessKey: 'owned-secret',
      s3ReferenceFileWithRelayMode: false,
    },
  },
  {
    provider: 'gcs',
    flag: 'GCS',
    payload: {
      gcsBucket: 'owned-bucket',
      gcsApiKeyJsonPath: '/owned/key.json',
      gcsUploadNamespace: 'owned',
      gcsReferenceFileWithRelayMode: false,
    },
  },
  {
    provider: 'azure',
    flag: 'AZURE',
    payload: {
      azureTenantId: 'owned-tenant',
      azureClientId: 'owned-client',
      azureClientSecret: 'owned-secret',
      azureStorageAccountName: 'owned-account',
      azureStorageContainerName: 'owned-container',
      azureReferenceFileWithRelayMode: false,
    },
  },
];

let app: express.Application;
beforeAll(async () => {
  const crowi = mock<Crowi>({
    events: { activity: { emit: vi.fn() } },
    setUpFileUpload: vi.fn().mockResolvedValue(undefined),
    fileUploaderSwitchService: { publishUpdatedMessage: vi.fn() },
  });
  configManager.setS2sMessagingService(mock<S2sMessagingService>());
  app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    const apiRes = res as ApiV3Response;
    apiRes.apiv3 = (data) => res.json(data);
    apiRes.apiv3Err = (error, status = 500) =>
      res.status(status).json({ error });
    next();
  });
  const { setup } = await import('./file-upload-setting');
  app.use('/', setup(crowi));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(cases)('$provider settings API', ({
  provider,
  flag,
  payload,
}) => {
  const prepare = async (locked: boolean) => {
    vi.stubEnv(`${flag}_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS`, String(locked));
    vi.stubEnv('S3_BUCKET', 'hosted-bucket');
    vi.stubEnv('S3_REGION', 'ap-northeast-1');
    vi.stubEnv('GCS_BUCKET', 'hosted-bucket');
    vi.stubEnv('AZURE_STORAGE_CONTAINER_NAME', 'hosted-container');
    vi.stubEnv(
      `${provider === 'aws' ? 'S3' : flag}_REFERENCE_FILE_WITH_RELAY_MODE`,
      'true',
    );
    vi.spyOn(ConfigLoader.prototype, 'loadFromDB').mockResolvedValue({});
    await configManager.loadConfigs();
  };

  it('does not persist storage overrides when hosted', async () => {
    await prepare(true);
    const response = await request(app)
      .put('/')
      .send({ fileUploadType: provider, ...payload })
      .expect(200);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { key: 'app:fileUploadType' },
          update: { value: JSON.stringify(provider) },
          upsert: true,
        },
      },
    ]);
    const relayField =
      provider === 'aws'
        ? 's3ReferenceFileWithRelayMode'
        : `${provider}ReferenceFileWithRelayMode`;
    expect(response.body.responseParams[relayField]).toBe(true);
  });

  it('persists storage overrides when owned', async () => {
    await prepare(false);
    await request(app)
      .put('/')
      .send({ fileUploadType: provider, ...payload })
      .expect(200);
    expect(bulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { key: `${provider}:referenceFileWithRelayMode` },
            update: { value: 'false' },
          }),
        }),
      ]),
    );
  });
});
