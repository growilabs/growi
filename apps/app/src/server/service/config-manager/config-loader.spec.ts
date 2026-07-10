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

  // ai:providers / ai:providerApiKeys are object-typed configs (defaultValue:
  // null — typeof null is 'object') that also have env vars, so the loader must
  // JSON.parse their env strings into objects. This is the contract for
  // "configuring multiple providers via environment variables only" (R5.1).
  describe('loadFromEnv (object-typed key from a JSON env var)', () => {
    const ENV_VARS = ['AI_PROVIDERS', 'AI_PROVIDER_API_KEYS'] as const;
    const originals = new Map(ENV_VARS.map((env) => [env, process.env[env]]));

    afterEach(() => {
      for (const env of ENV_VARS) {
        const original = originals.get(env);
        if (original === undefined) {
          delete process.env[env];
        } else {
          process.env[env] = original;
        }
      }
    });

    it('parses a JSON AI_PROVIDERS string into an object', async () => {
      process.env.AI_PROVIDERS =
        '{"openai":{"enabled":true},"azure-openai":{"enabled":true,"azureOpenaiSettings":{"resourceName":"my-res","useEntraId":true}}}';

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:providers'].value).toEqual({
        openai: { enabled: true },
        'azure-openai': {
          enabled: true,
          azureOpenaiSettings: { resourceName: 'my-res', useEntraId: true },
        },
      });
    });

    it('parses a JSON AI_PROVIDER_API_KEYS string into an object', async () => {
      process.env.AI_PROVIDER_API_KEYS =
        '{"openai":"sk-test","anthropic":"ant-test"}';

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:providerApiKeys'].value).toEqual({
        openai: 'sk-test',
        anthropic: 'ant-test',
      });
    });

    it('falls back to null on malformed JSON (fail-soft, no boot crash)', async () => {
      process.env.AI_PROVIDERS = '{not valid json';

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:providers'].value).toBeNull();
    });

    it('uses the null default when the env var is unset (= AI not configured)', async () => {
      delete process.env.AI_PROVIDERS;

      const config: RawConfigData<ConfigKey, ConfigValues> =
        await configLoader.loadFromEnv();

      expect(config['ai:providers'].value).toBeNull();
    });
  });
});
