import { toNonBlankString } from '@growi/core/dist/interfaces';
import type { Request } from 'express';
import express from 'express';
import mockRequire from 'mock-require';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

// Mock middlewares using mock-require BEFORE importing the router
const mockActivityId = '507f1f77bcf86cd799439011';

// Mock the dependencies that login-required.js and admin-required.js need
mockRequire.stopAll();

mockRequire('~/server/middlewares/access-token-parser', {
  accessTokenParser: () => (_req: Request, _res: ApiV3Response, next: () => void) => next(),
});

mockRequire('../../../middlewares/login-required', () => (_req: Request, _res: ApiV3Response, next: () => void) => next());
mockRequire('../../../middlewares/admin-required', () => (_req: Request, _res: ApiV3Response, next: () => void) => next());

mockRequire('../../../middlewares/add-activity', {
  generateAddActivityMiddleware: () => (_req: Request, res: ApiV3Response, next: () => void) => {
    res.locals = res.locals || {};
    res.locals.activity = { _id: mockActivityId };
    next();
  },
});

describe('file-upload-setting route', () => {
  let app: express.Application;
  let crowiMock: Crowi;

  beforeEach(async() => {
    // Initialize configManager for each test
    const s2sMessagingServiceMock = mock<S2sMessagingService>();
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
    await configManager.loadConfigs();

    // Mock crowi instance
    crowiMock = mock<Crowi>({
      event: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
      setUpFileUpload: vi.fn().mockResolvedValue(undefined),
      fileUploaderSwitchService: {
        publishUpdatedMessage: vi.fn(),
      },
    });

    // Setup express app
    app = express();
    app.use(express.json());

    // Mock apiv3 response methods
    app.use((_req, res, next) => {
      const apiRes = res as ApiV3Response;
      apiRes.apiv3 = data => res.json(data);
      apiRes.apiv3Err = (error, statusCode = 500) => res.status(statusCode).json({ error });
      next();
    });

    // Import and mount the actual router using dynamic import
    const fileUploadSettingModule = await import('./file-upload-setting');
    const fileUploadSettingRouterFactory = (fileUploadSettingModule as any).default || fileUploadSettingModule;
    const fileUploadSettingRouter = fileUploadSettingRouterFactory(crowiMock);
    app.use('/', fileUploadSettingRouter);
  });

  afterAll(() => {
    mockRequire.stopAll();
  });

  it('should update file upload type to local', async() => {
    const response = await request(app)
      .put('/')
      .send({
        fileUploadType: 'local',
      })
      .expect(200);

    expect(response.body.responseParams).toBeDefined();
    expect(response.body.responseParams.fileUploadType).toBe('local');
    expect(crowiMock.setUpFileUpload).toHaveBeenCalledWith(true);
  });

  describe('AWS settings', () => {
    const setupAwsSecret = async(secret: string) => {
      await configManager.updateConfigs({
        'app:fileUploadType': 'aws',
        'aws:s3SecretAccessKey': toNonBlankString(secret),
        'aws:s3Region': toNonBlankString('us-west-2'),
        'aws:s3Bucket': toNonBlankString('existing-bucket'),
      });
      await configManager.loadConfigs();
    };

    it('should preserve existing s3SecretAccessKey when not included in request', async() => {
      const existingSecret = 'existing-secret-key-12345';
      await setupAwsSecret(existingSecret);

      expect(configManager.getConfig('aws:s3SecretAccessKey')).toBe(existingSecret);

      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'aws',
          s3Region: 'us-east-1',
          s3Bucket: 'test-bucket',
          s3ReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('aws:s3SecretAccessKey')).toBe(existingSecret);
      expect(response.body.responseParams.fileUploadType).toBe('aws');
    });

    it('should update s3SecretAccessKey when new value is provided in request', async() => {
      const existingSecret = 'existing-secret-key-12345';
      await setupAwsSecret(existingSecret);

      expect(configManager.getConfig('aws:s3SecretAccessKey')).toBe(existingSecret);

      const newSecret = 'new-secret-key-67890';
      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'aws',
          s3Region: 'us-east-1',
          s3Bucket: 'test-bucket',
          s3SecretAccessKey: newSecret,
          s3ReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('aws:s3SecretAccessKey')).toBe(newSecret);
      expect(response.body.responseParams.fileUploadType).toBe('aws');
    });

    it('should remove s3SecretAccessKey when empty string is provided in request', async() => {
      const existingSecret = 'existing-secret-key-12345';
      await setupAwsSecret(existingSecret);

      expect(configManager.getConfig('aws:s3SecretAccessKey')).toBe(existingSecret);

      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'aws',
          s3Region: 'us-east-1',
          s3Bucket: 'test-bucket',
          s3SecretAccessKey: '',
          s3ReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('aws:s3SecretAccessKey')).toBeUndefined();
      expect(response.body.responseParams.fileUploadType).toBe('aws');
    });
  });

  describe('GCS settings', () => {
    const setupGcsSecret = async(apiKeyPath: string) => {
      await configManager.updateConfigs({
        'app:fileUploadType': 'gcs',
        'gcs:apiKeyJsonPath': toNonBlankString(apiKeyPath),
        'gcs:bucket': toNonBlankString('existing-bucket'),
      });
      await configManager.loadConfigs();
    };

    it('should preserve existing gcsApiKeyJsonPath when not included in request', async() => {
      const existingApiKeyPath = '/path/to/existing-api-key.json';
      await setupGcsSecret(existingApiKeyPath);

      expect(configManager.getConfig('gcs:apiKeyJsonPath')).toBe(existingApiKeyPath);

      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'gcs',
          gcsBucket: 'test-bucket',
          gcsReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('gcs:apiKeyJsonPath')).toBe(existingApiKeyPath);
      expect(response.body.responseParams.fileUploadType).toBe('gcs');
    });

    it('should update gcsApiKeyJsonPath when new value is provided in request', async() => {
      const existingApiKeyPath = '/path/to/existing-api-key.json';
      await setupGcsSecret(existingApiKeyPath);

      expect(configManager.getConfig('gcs:apiKeyJsonPath')).toBe(existingApiKeyPath);

      const newApiKeyPath = '/path/to/new-api-key.json';
      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'gcs',
          gcsBucket: 'test-bucket',
          gcsApiKeyJsonPath: newApiKeyPath,
          gcsReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('gcs:apiKeyJsonPath')).toBe(newApiKeyPath);
      expect(response.body.responseParams.fileUploadType).toBe('gcs');
    });

    it('should remove gcsApiKeyJsonPath when empty string is provided in request', async() => {
      const existingApiKeyPath = '/path/to/existing-api-key.json';
      await setupGcsSecret(existingApiKeyPath);

      expect(configManager.getConfig('gcs:apiKeyJsonPath')).toBe(existingApiKeyPath);

      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'gcs',
          gcsBucket: 'test-bucket',
          gcsApiKeyJsonPath: '',
          gcsReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('gcs:apiKeyJsonPath')).toBeUndefined();
      expect(response.body.responseParams.fileUploadType).toBe('gcs');
    });
  });

  describe('Azure settings', () => {
    const setupAzureSecret = async(secret: string) => {
      await configManager.updateConfigs({
        'app:fileUploadType': 'azure',
        'azure:clientSecret': toNonBlankString(secret),
        'azure:tenantId': toNonBlankString('existing-tenant-id'),
        'azure:clientId': toNonBlankString('existing-client-id'),
        'azure:storageAccountName': toNonBlankString('existingaccount'),
        'azure:storageContainerName': toNonBlankString('existing-container'),
      });
      await configManager.loadConfigs();
    };

    it('should preserve existing azureClientSecret when not included in request', async() => {
      const existingSecret = 'existing-azure-secret-12345';
      await setupAzureSecret(existingSecret);

      expect(configManager.getConfig('azure:clientSecret')).toBe(existingSecret);

      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'azure',
          azureTenantId: 'new-tenant-id',
          azureClientId: 'new-client-id',
          azureStorageAccountName: 'newaccount',
          azureStorageContainerName: 'new-container',
          azureReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('azure:clientSecret')).toBe(existingSecret);
      expect(response.body.responseParams.fileUploadType).toBe('azure');
    });

    it('should update azureClientSecret when new value is provided in request', async() => {
      const existingSecret = 'existing-azure-secret-12345';
      await setupAzureSecret(existingSecret);

      expect(configManager.getConfig('azure:clientSecret')).toBe(existingSecret);

      const newSecret = 'new-azure-secret-67890';
      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'azure',
          azureTenantId: 'new-tenant-id',
          azureClientId: 'new-client-id',
          azureStorageAccountName: 'newaccount',
          azureStorageContainerName: 'new-container',
          azureClientSecret: newSecret,
          azureReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('azure:clientSecret')).toBe(newSecret);
      expect(response.body.responseParams.fileUploadType).toBe('azure');
    });

    it('should remove azureClientSecret when empty string is provided in request', async() => {
      const existingSecret = 'existing-azure-secret-12345';
      await setupAzureSecret(existingSecret);

      expect(configManager.getConfig('azure:clientSecret')).toBe(existingSecret);

      const response = await request(app)
        .put('/')
        .send({
          fileUploadType: 'azure',
          azureTenantId: 'new-tenant-id',
          azureClientId: 'new-client-id',
          azureStorageAccountName: 'newaccount',
          azureStorageContainerName: 'new-container',
          azureClientSecret: '',
          azureReferenceFileWithRelayMode: false,
        })
        .expect(200);

      await configManager.loadConfigs();

      expect(configManager.getConfig('azure:clientSecret')).toBeUndefined();
      expect(response.body.responseParams.fileUploadType).toBe('azure');
    });
  });
});
