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
      vi.unstubAllEnvs();
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

    it('falls back to the null default on malformed JSON when strict mode is off', async () => {
      vi.stubEnv('CHECK_CONFIGURATION_VALUE_STRICTLY', 'false');
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

  describe('loadFromEnv value validation', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    describe('in strict mode (default)', () => {
      it('throws listing every invalid env var, without their values', async () => {
        vi.stubEnv('ELASTICSEARCH_REQUEST_TIMEOUT', '0x1F');
        vi.stubEnv('TRUST_PROXY_BOOL', 'yes');
        vi.stubEnv('AI_PROVIDER_API_KEYS', '{"openai":"sk-secret"');

        const error = await configLoader.loadFromEnv().catch((e) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('ELASTICSEARCH_REQUEST_TIMEOUT');
        expect(error.message).toContain('TRUST_PROXY_BOOL');
        expect(error.message).toContain('AI_PROVIDER_API_KEYS');
        expect(error.message).not.toContain('0x1F');
        expect(error.message).not.toContain('sk-secret');
      });

      it('throws on an invalid number for a config whose default is undefined', async () => {
        vi.stubEnv('SESSION_MAX_AGE', '3600abc');

        await expect(configLoader.loadFromEnv()).rejects.toThrow(
          'SESSION_MAX_AGE',
        );
      });

      it('throws when the strict mode flag itself is invalid', async () => {
        vi.stubEnv('CHECK_CONFIGURATION_VALUE_STRICTLY', 'ture');
        vi.stubEnv('ELASTICSEARCH_REQUEST_TIMEOUT', 'abc');

        await expect(configLoader.loadFromEnv()).rejects.toThrow(
          'CHECK_CONFIGURATION_VALUE_STRICTLY',
        );
      });

      it('parses valid values into their declared types', async () => {
        vi.stubEnv('ELASTICSEARCH_REQUEST_TIMEOUT', '0.5');
        vi.stubEnv('SESSION_MAX_AGE', '3600');
        vi.stubEnv('TRUST_PROXY_BOOL', 'false');
        vi.stubEnv('CHANGE_PROPOSAL_MAX_PROPOSALS_PER_USER_PER_DAY', '10');

        const config = await configLoader.loadFromEnv();

        expect(config['app:elasticsearchRequestTimeout'].value).toBe(0.5);
        expect(config['security:sessionMaxAge'].value).toBe(3600);
        expect(config['security:trustProxyBool'].value).toBe(false);
        expect(config['changeProposal:maxProposalsPerUserPerDay'].value).toBe(
          10,
        );
      });

      it('treats an empty value of a non-string config as unset', async () => {
        vi.stubEnv('ELASTICSEARCH_REQUEST_TIMEOUT', '');
        vi.stubEnv('SESSION_MAX_AGE', '');

        const config = await configLoader.loadFromEnv();

        expect(config['app:elasticsearchRequestTimeout'].value).toBe(8000);
        expect(config['security:sessionMaxAge'].value).toBeUndefined();
      });
    });

    describe('in non-strict mode', () => {
      beforeEach(() => {
        vi.stubEnv('CHECK_CONFIGURATION_VALUE_STRICTLY', 'false');
      });

      it('uses the default value for an invalid env var', async () => {
        vi.stubEnv('ELASTICSEARCH_REQUEST_TIMEOUT', '12abc');
        vi.stubEnv('ELASTICSEARCH_REJECT_UNAUTHORIZED', 'yes');

        const config = await configLoader.loadFromEnv();

        expect(config['app:elasticsearchRequestTimeout'].value).toBe(8000);
        expect(config['app:elasticsearchRejectUnauthorized'].value).toBe(false);
      });

      it('still parses valid values', async () => {
        vi.stubEnv('ELASTICSEARCH_REQUEST_TIMEOUT', '15000');

        const config = await configLoader.loadFromEnv();

        expect(config['app:elasticsearchRequestTimeout'].value).toBe(15000);
      });
    });
  });
});
