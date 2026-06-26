// --- Cross-cutting integration: env-only mode through BOTH handlers ---------
//
// Per-task unit tests already cover each handler against a MOCKED configManager
// (get-ai-settings.spec.ts / put-ai-settings.spec.ts return the
// `env:useOnlyEnvVars:ai` verdict directly from a stubbed getConfig), and
// config-manager.spec.ts covers the getConfig resolution in isolation (no
// handlers). What no single prior task owns is proving that the SAME control
// flag is wired CONSISTENTLY end-to-end across both handlers through the REAL
// configManager — i.e. the actual ENV_ONLY_GROUPS / shouldUseEnvOnly wiring from
// task 1.2, not isolated per-handler mocks (Req 4.1 / 4.2 / 4.3).
//
// Strategy: drive the real getAiSettings and putAiSettingsFactory handlers
// against the REAL configManager singleton. Only the source layer is faked —
// dbConfig/envConfig are injected via Object.defineProperties (the same harness
// pattern config-manager.spec.ts uses), so getConfig flows through the genuine
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

import type {
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

// Distinct db vs env values per AI key so a resolution that reads the wrong
// source is observable in the GET response. The per-model allow-list (the key
// this feature manages) carries a distinct default model id per source so a
// wrong-source read is observable through allowedModels.
const DB: Partial<TestConfigData> = {
  'app:aiEnabled': { value: true },
  'ai:provider': { value: 'openai' },
  'ai:apiKey': { value: 'db-secret-key' },
  'ai:allowedModels': { value: [{ modelId: 'db-model', isDefault: true }] },
};
const ENV = (useOnlyEnvVars: boolean): Partial<TestConfigData> => ({
  'app:aiEnabled': { value: false },
  'ai:provider': { value: 'anthropic' },
  'ai:apiKey': { value: 'env-secret-key' },
  'ai:allowedModels': { value: [{ modelId: 'env-model', isDefault: true }] },
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

describe('admin-ai-settings env-only mode end-to-end (Req 4.1, 4.2, 4.3)', () => {
  describe('when env:useOnlyEnvVars:ai is TRUE (the shared flag is on)', () => {
    beforeEach(() => {
      setSources(DB, ENV(true));
    });

    it('GET reports useOnlyEnvVars=true AND resolves ai:* to env values, ignoring DB (Req 4.1, 4.2)', () => {
      const body = invokeGet();

      // The flag is surfaced for the UI to lock editing (Req 4.2)...
      expect(body.useOnlyEnvVars).toBe(true);
      // ...and the SAME flag makes the real configManager fix the effective AI
      // values to env, ignoring the DB values entirely (Req 4.1). This is the
      // genuine ENV_ONLY_GROUPS wiring — not a per-handler stub.
      expect(body.provider).toBe('anthropic'); // env, not the DB 'openai'
      // The allow-list resolves to the env value, not the DB one (Req 4.1, 6.2:
      // GET still works under env-only and reflects the env-fixed allow-list).
      expect(body.allowedModels).toEqual([
        { modelId: 'env-model', isDefault: true },
      ]);
      expect(body.aiEnabled).toBe(false); // env, not the DB true
      // apiKey value is never returned; only its presence (env key is set).
      expect(body.isApiKeySet).toBe(true);
      expect(JSON.stringify(body)).not.toContain('secret-key');
    });

    it('PUT rejects with 422 and persists nothing — same flag, other handler (Req 1.6, 4.3)', async () => {
      const { res, emit } = await invokePut({
        provider: 'google',
        allowedModels: [{ modelId: 'should-not-be-saved', isDefault: true }],
      });

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(apiv3Err.mock.calls[0][1]).toBe(422);
      expect(res.apiv3).not.toHaveBeenCalled();
      // Nothing written, no cache clear, no audit event.
      expect(ConfigMock.bulkWrite).not.toHaveBeenCalled();
      expect(clearResolvedMastraModelCache).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('when env:useOnlyEnvVars:ai is FALSE (the shared flag is off)', () => {
    beforeEach(() => {
      setSources(DB, ENV(false));
    });

    it('GET reports useOnlyEnvVars=false AND resolves ai:* DB-first (env as fallback) (Req 4.4)', () => {
      const body = invokeGet();

      expect(body.useOnlyEnvVars).toBe(false);
      // Same flag off -> DB values win, proving the wiring is consistent.
      expect(body.provider).toBe('openai'); // DB, not env 'anthropic'
      // The allow-list resolves DB-first when the flag is off.
      expect(body.allowedModels).toEqual([
        { modelId: 'db-model', isDefault: true },
      ]);
      expect(body.aiEnabled).toBe(true); // DB, not env false
    });

    it('PUT persists the update through the real configManager (no 422) (Req 4.3 inverse)', async () => {
      const { res, emit } = await invokePut({
        provider: 'google',
        allowedModels: [{ modelId: 'gpt-via-google', isDefault: true }],
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
