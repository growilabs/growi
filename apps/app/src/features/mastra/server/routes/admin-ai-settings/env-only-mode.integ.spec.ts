// --- Cross-cutting integration: env-only mode through BOTH handlers ---------
//
// Per-task unit tests already cover each handler against a MOCKED configManager
// (get-ai-settings.spec.ts / put-ai-settings.spec.ts return the
// `env:useOnlyEnvVars:ai` verdict directly from a stubbed getConfig), and
// config-manager.spec.ts covers the getConfig resolution in isolation (no
// handlers). What no single prior task owns is proving that the SAME control
// flag drives BOTH handlers CONSISTENTLY end-to-end through the REAL
// configManager — i.e. the actual ENV_ONLY_GROUPS / shouldUseEnvOnly wiring, not
// isolated per-handler mocks (Req 5.2, 5.3, 5.4).
//
// Under env-only mode the connection settings (app:aiEnabled / ai:providers /
// ai:providerApiKeys) are FIXED to env values and read-only, while ai:allowedModels
// stays DB-editable (it is deliberately NOT in the env-only group — Req 5.3). So:
//   - GET reflects the env-fixed provider settings and the DB-first allow-list.
//   - PUT with `providers` or `aiEnabled` is rejected with 400 (Req 5.2), while a
//     PUT with only `allowedModels` is persisted (Req 5.3), under the SAME
//     validation as normal (Req 5.4).
//
// Strategy: drive the real getAiSettings and putAiSettingsFactory handlers against
// the REAL configManager singleton. Only the source layer is faked — dbConfig/
// envConfig are injected via Object.defineProperties (the harness pattern
// config-manager.spec.ts uses), so getConfig flows through the genuine
// keyToGroupMap + shouldUseEnvOnly logic. Leaf collaborators that would reach a
// real model/DB are mocked:
//   - isAiConfigured (GET's "configured?" leaf — would otherwise build a model)
//   - clearResolvedMastraModelCache (PUT's cache-clear leaf)
//   - the Config model used by updateConfigs (so PUT does not touch a real DB)
// configManager itself is NOT mocked: it is the wiring under test.
const { isAiConfigured } = vi.hoisted(() => ({ isAiConfigured: vi.fn() }));
const { clearResolvedMastraModelCache } = vi.hoisted(() => ({
  clearResolvedMastraModelCache: vi.fn(),
}));
const { ConfigMock } = vi.hoisted(() => ({
  ConfigMock: { bulkWrite: vi.fn() },
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured,
}));
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model',
  () => ({ clearResolvedMastraModelCache }),
);
// updateConfigs dynamically imports '../../models/config' (relative to
// config-manager.ts) — mock it so the real updateConfigs path runs without a DB.
vi.mock('~/server/models/config', () => ({ Config: ConfigMock }));

import type { RawConfigData } from '@growi/core/dist/interfaces';
import type { Request } from 'express';
import { mock } from 'vitest-mock-extended';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import type {
  ConfigKey,
  ConfigValues,
} from '~/server/service/config-manager/config-definition';

import type { AiProvider } from '../../../interfaces/ai-provider';
import type {
  AiProviderUpdateRequest,
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../../interfaces/ai-settings';
import { getAiSettings } from './get-ai-settings';
import { putAiSettingsFactory } from './put-ai-settings';

type TestConfigData = RawConfigData<ConfigKey, ConfigValues>;

// Inject db/env sources straight into the real configManager so getConfig
// resolves through the genuine env-only wiring (same seam as config-manager.spec.ts).
const setSources = (
  dbConfig: Partial<TestConfigData>,
  envConfig: Partial<TestConfigData>,
): void => {
  Object.defineProperties(configManager, {
    dbConfig: { value: dbConfig, configurable: true },
    envConfig: { value: envConfig, configurable: true },
  });
};

// A `providers` update must carry an entry for every supported provider.
const providersRequest = (
  overrides: Partial<Record<AiProvider, AiProviderUpdateRequest>> = {},
): Record<AiProvider, AiProviderUpdateRequest> => ({
  openai: {},
  anthropic: {},
  google: {},
  'azure-openai': {},
  ...overrides,
});

// Distinct db vs env values per AI key so a resolution that reads the wrong source
// is observable. The env-only group covers app:aiEnabled / ai:providers /
// ai:providerApiKeys; ai:allowedModels is NOT in the group (resolves DB-first
// always — Req 5.3). API key VALUES never appear in any response, only presence.
const DB: Partial<TestConfigData> = {
  'app:aiEnabled': { value: true },
  'ai:providers': { value: { openai: { enabled: true } } },
  'ai:providerApiKeys': { value: { openai: 'db-secret-key' } },
  'ai:allowedModels': {
    value: [{ provider: 'openai', modelId: 'db-model', isDefault: true }],
  },
};
const ENV = (useOnlyEnvVars: boolean): Partial<TestConfigData> => ({
  'app:aiEnabled': { value: false },
  'ai:providers': { value: { anthropic: { enabled: true } } },
  'ai:providerApiKeys': { value: { anthropic: 'env-secret-key' } },
  'ai:allowedModels': {
    value: [{ provider: 'anthropic', modelId: 'env-model', isDefault: true }],
  },
  'env:useOnlyEnvVars:ai': { value: useOnlyEnvVars },
});

const invokeGet = (): AiSettingsResponse => {
  const req = mock<Request>();
  const res = mock<ApiV3Response>();
  getAiSettings(req, res);
  const apiv3 = vi.mocked(res.apiv3);
  expect(res.apiv3Err).not.toHaveBeenCalled();
  expect(apiv3).toHaveBeenCalledTimes(1);
  return apiv3.mock.calls[0][0] as AiSettingsResponse;
};

const invokePut = async (body: AiSettingsUpdateRequest) => {
  const emit = vi.fn();
  const crowi = mock<Crowi>({
    events: {
      activity: { emit } as unknown as Crowi['events']['activity'],
    },
  });
  const req = mock<CrowiRequest>();
  req.body = body;
  const res = mock<ApiV3Response>();
  res.locals = { activity: { _id: 'activity-id' } };

  // putAiSettingsFactory returns the full middleware chain; the terminal handler
  // (whose env-only wiring we exercise here) is the LAST element.
  const chain = putAiSettingsFactory(crowi);
  const handler = chain[chain.length - 1] as (
    req: CrowiRequest,
    res: ApiV3Response,
  ) => Promise<void>;
  await handler(req, res);
  return { res, emit };
};

beforeEach(() => {
  vi.clearAllMocks();
  isAiConfigured.mockReturnValue(true);
  ConfigMock.bulkWrite.mockResolvedValue(undefined);
  // The real updateConfigs reloads db config after writing; keep that a no-op so
  // it does not overwrite the injected dbConfig with a real DB read.
  vi.spyOn(configManager, 'loadConfigs').mockResolvedValue(undefined);
  // updateConfigs publishes an s2s message after writing; stub it out.
  vi.spyOn(configManager, 'publishUpdateMessage').mockResolvedValue(undefined);
});

describe('admin-ai-settings env-only mode end-to-end (Req 5.2, 5.3, 5.4)', () => {
  describe('when env:useOnlyEnvVars:ai is TRUE (the shared flag is on)', () => {
    beforeEach(() => {
      setSources(DB, ENV(true));
    });

    it('GET reports useOnlyEnvVars=true AND resolves connection settings to env, ignoring DB (Req 5.2)', () => {
      const body = invokeGet();

      // The flag is surfaced for the UI to lock connection-setting editing...
      expect(body.useOnlyEnvVars).toBe(true);
      // ...and the SAME flag makes the real configManager fix app:aiEnabled /
      // ai:providers / ai:providerApiKeys to env, ignoring DB (genuine
      // ENV_ONLY_GROUPS wiring — not a per-handler stub).
      expect(body.aiEnabled).toBe(false); // env, not the DB true
      expect(body.providers.anthropic.enabled).toBe(true); // env has anthropic on
      expect(body.providers.openai.enabled).toBe(false); // DB openai ignored
      // isApiKeySet reflects the env key set (anthropic), not the DB one (openai).
      expect(body.providers.anthropic.isApiKeySet).toBe(true);
      expect(body.providers.openai.isApiKeySet).toBe(false);
      // The allow-list is NOT env-locked: it resolves DB-first even under env-only
      // (Req 5.3 — model settings stay DB-editable).
      expect(body.allowedModels).toEqual([
        { provider: 'openai', modelId: 'db-model', isDefault: true },
      ]);
      // No API key VALUE is ever returned, only presence.
      expect(JSON.stringify(body)).not.toContain('secret-key');
    });

    it('PUT with providers rejects with 400 and persists nothing (Req 5.2)', async () => {
      const { res, emit } = await invokePut({
        providers: providersRequest({ google: { apiKey: 'should-not-save' } }),
      });

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(apiv3Err.mock.calls[0][1]).toBe(400);
      expect(res.apiv3).not.toHaveBeenCalled();
      // Nothing written, no cache clear, no audit event.
      expect(ConfigMock.bulkWrite).not.toHaveBeenCalled();
      expect(clearResolvedMastraModelCache).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('PUT with aiEnabled rejects with 400 and persists nothing (Req 5.2)', async () => {
      const { res } = await invokePut({ aiEnabled: true });

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(apiv3Err.mock.calls[0][1]).toBe(400);
      expect(ConfigMock.bulkWrite).not.toHaveBeenCalled();
    });

    it('PUT with ONLY allowedModels persists through the real configManager under env-only (Req 5.3, 5.4)', async () => {
      const { res, emit } = await invokePut({
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-5', isDefault: true },
        ],
      });

      // Not rejected: models stay editable under env-only, under the same validation.
      expect(res.apiv3Err).not.toHaveBeenCalled();
      expect(res.apiv3).toHaveBeenCalledTimes(1);
      expect(ConfigMock.bulkWrite).toHaveBeenCalledTimes(1);
      expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('when env:useOnlyEnvVars:ai is FALSE (the shared flag is off)', () => {
    beforeEach(() => {
      setSources(DB, ENV(false));
    });

    it('GET reports useOnlyEnvVars=false AND resolves connection settings DB-first (Req 5.2 inverse)', () => {
      const body = invokeGet();

      expect(body.useOnlyEnvVars).toBe(false);
      // Same flag off -> DB values win, proving the wiring is consistent.
      expect(body.aiEnabled).toBe(true); // DB, not env false
      expect(body.providers.openai.enabled).toBe(true); // DB has openai on
      expect(body.providers.anthropic.enabled).toBe(false); // env anthropic ignored
      expect(body.providers.openai.isApiKeySet).toBe(true); // DB key
      expect(body.providers.anthropic.isApiKeySet).toBe(false);
      expect(body.allowedModels).toEqual([
        { provider: 'openai', modelId: 'db-model', isDefault: true },
      ]);
    });

    it('PUT persists providers + allowedModels through the real configManager (no 400) (Req 5.2 inverse)', async () => {
      const { res, emit } = await invokePut({
        aiEnabled: true,
        providers: providersRequest({ google: { apiKey: 'sk-google' } }),
        allowedModels: [
          { provider: 'google', modelId: 'gemini', isDefault: true },
        ],
      });

      // No rejection: the same flag being off lets the write through both ends.
      expect(res.apiv3Err).not.toHaveBeenCalled();
      expect(res.apiv3).toHaveBeenCalledTimes(1);
      // The real updateConfigs reached the persistence boundary (bulkWrite),
      // then the success side effects fired.
      expect(ConfigMock.bulkWrite).toHaveBeenCalledTimes(1);
      expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });
});
