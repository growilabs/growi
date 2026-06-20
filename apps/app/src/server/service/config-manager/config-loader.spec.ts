import type { RawConfigData } from '@growi/core/dist/interfaces';

import type { ConfigKey, ConfigValues } from './config-definition';
import { ConfigLoader } from './config-loader';

const mockExec = vi.fn();
const mockFind = vi.fn().mockReturnValue({ exec: mockExec });

// Mock the Config model
vi.mock('../../models/config', () => ({
  Config: {
    find: mockFind,
  },
}));

describe('ConfigLoader', () => {
  let configLoader: ConfigLoader;

  beforeEach(async () => {
    configLoader = new ConfigLoader();
    vi.clearAllMocks();
  });

  describe('loadFromDB', () => {
    describe('when doc.value is empty string', () => {
      beforeEach(() => {
        const mockDocs = [
          { key: 'app:referrerPolicy' as ConfigKey, value: '' },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return null for value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toBe(null);
      });
    });

    describe('when doc.value is invalid JSON', () => {
      beforeEach(() => {
        const mockDocs = [
          { key: 'app:referrerPolicy' as ConfigKey, value: '{invalid:json' },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return null for value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toBe(null);
      });
    });

    describe('when doc.value is valid JSON', () => {
      const validJson = { key: 'value' };
      beforeEach(() => {
        const mockDocs = [
          {
            key: 'app:referrerPolicy' as ConfigKey,
            value: JSON.stringify(validJson),
          },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return parsed value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toEqual(validJson);
      });
    });

    describe('when doc.value is null', () => {
      beforeEach(() => {
        const mockDocs = [
          { key: 'app:referrerPolicy' as ConfigKey, value: null },
        ];
        mockExec.mockResolvedValue(mockDocs);
      });

      it('should return null for value', async () => {
        const config: RawConfigData<ConfigKey, ConfigValues> =
          await configLoader.loadFromDB();
        expect(config['app:referrerPolicy'].value).toBe(null);
      });
    });
  });

  // ai:azureOpenaiSettings is an object-typed config (defaultValue: {}) that also
  // has an env var, so the loader must JSON.parse its env string into an object.
  // This is the contract for "setting an object via an environment variable".
  describe('loadFromEnv (object-typed key from a JSON env var)', () => {
    const ENV = 'AI_AZURE_OPENAI_SETTINGS';
    const original = process.env[ENV];

    afterEach(() => {
      if (original === undefined) {
        delete process.env[ENV];
      } else {
        process.env[ENV] = original;
      }
    });

    it('parses a JSON object string into an object', async () => {
      process.env[ENV] = '{"resourceName":"my-res","useEntraId":true}';

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:azureOpenaiSettings'].value).toEqual({
        resourceName: 'my-res',
        useEntraId: true,
      });
    });

    it('falls back to null on malformed JSON (fail-soft, no boot crash)', async () => {
      process.env[ENV] = '{not valid json';

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:azureOpenaiSettings'].value).toBeNull();
    });

    it('uses the empty-object default when the env var is unset', async () => {
      delete process.env[ENV];

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:azureOpenaiSettings'].value).toEqual({});
    });
  });
});
