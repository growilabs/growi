// --- Mock boundary ---------------------------------------------------------
//
// putAiSettings persists the submitted multi-provider AI configuration. Its
// observable contract is a set of side effects at these boundaries plus the
// env-only guard:
//   - configManager.getConfig('env:useOnlyEnvVars:ai'): when true, a request that
//     contains `providers` or `aiEnabled` is rejected with 400 and NOTHING is
//     persisted (connection settings are env-only, Req 5.2); an allowedModels-only
//     request still proceeds (Req 5.3).
//   - configManager.getConfig('ai:providerApiKeys'): the CURRENT merged (DB ?? env)
//     view of the per-provider keys, read at SAVE time so the key merge carries
//     forward keys for providers not in this request — including env-derived ones
//     (Req 1.3, 1.4).
//   - configManager.updateConfigs(updates): the persistence boundary. The contract
//     is the SHAPE of `updates` (which keys, with what values):
//       * app:aiEnabled     — written only when `aiEnabled` is provided (omit = unchanged)
//       * ai:providers      — written only when `providers` is provided; full-state
//         replace over all 4 providers (enabled flag + Azure connection settings).
//         Disabling a provider preserves its key/azure settings (Req 1.6).
//       * ai:allowedModels  — written only when `allowedModels` is provided; stored
//         VERBATIM, including an empty [] ("no allowed models", Req 3.3) — never
//         collapsed to a key deletion / env fallback.
//       * ai:providerApiKeys — the merge exception: written ONLY when the request
//         carries at least one NON-EMPTY apiKey; then set to
//         { ...currentMergedView, ...requestNonEmptyKeys } (overwrite-only, never
//         cleared). A toggle/model-only save writes no key so an env-provided key is
//         never duplicated into the DB (Req 1.3, 1.4).
//   - clearResolvedMastraModelCache() AND clearAvailabilityLogDedup(): invalidated
//     on success so the next request rebuilds the model and re-notifies any
//     remaining misconfiguration without a restart.
//   - activityEvent.emit('update', activity._id, { action }): audit log.
//   - on failure: apiv3Err is answered and the apiKey value never reaches the error
//     message or the log (Req 1.9).
// We mock the collaborators so the test exercises only this handler's mapping and
// side effects, not how a value is persisted.
const { getConfig, updateConfigs } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  // Typed with its real call shape (the updates map) so mock.calls[i][0] is a
  // Record with no cast at the read sites.
  updateConfigs: vi.fn<(updates: Record<string, unknown>) => Promise<void>>(),
}));
// The apiKey merge reads the CURRENT keys through the SHAPE-GUARDED accessor
// (readProviderApiKeys), NOT raw getConfig — so a malformed config reads as unset
// instead of being spread into junk. Mock it here to drive the merge base.
const { readProviderApiKeys } = vi.hoisted(() => ({
  readProviderApiKeys: vi.fn(),
}));
// The logger boundary: the failure path must log the situation WITHOUT the apiKey
// (Req 1.9), so we capture every logger.error argument and assert no secret leaks.
const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
const { clearResolvedMastraModelCache } = vi.hoisted(() => ({
  clearResolvedMastraModelCache: vi.fn(),
}));
const { clearAvailabilityLogDedup } = vi.hoisted(() => ({
  clearAvailabilityLogDedup: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig, updateConfigs },
}));

vi.mock('../../services/ai-sdk-modules/llm-providers/config', () => ({
  readProviderApiKeys,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: loggerError,
    debug: vi.fn(),
  }),
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model',
  () => ({
    clearResolvedMastraModelCache,
  }),
);

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/llm-providers/warn-dedup',
  () => ({
    clearAvailabilityLogDedup,
  }),
);

import type { Request } from 'express';
import { validationResult } from 'express-validator';
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { AiProvider } from '../../../interfaces/ai-provider';
import type {
  AiProviderUpdateRequest,
  AiSettingsUpdateRequest,
} from '../../../interfaces/ai-settings';
import type { AiProviderApiKeys } from '../../../interfaces/provider-settings';
import { isRecord } from '../../../utils/is-record';
import {
  putAiSettingsFactory,
  updateAiSettingsValidators,
} from './put-ai-settings';

const ACTIVITY_ID = 'activity-id-1';

// A typed activity event emitter the factory pulls from crowi.events.activity.
const emit = vi.fn();

const buildCrowi = (): Crowi =>
  mock<Crowi>({
    events: {
      // events.activity is an EventEmitter; we only need emit() observable here.
      activity: { emit } as unknown as Crowi['events']['activity'],
    },
  });

// `providers` requests must carry an entry for every supported provider
// (fixed-slot model). This builds a full 4-entry Record, applying overrides.
const providersRequest = (
  overrides: Partial<Record<AiProvider, AiProviderUpdateRequest>> = {},
): Record<AiProvider, AiProviderUpdateRequest> => ({
  openai: {},
  anthropic: {},
  google: {},
  'azure-openai': {},
  ...overrides,
});

const invoke = async (
  body: AiSettingsUpdateRequest,
  {
    useOnlyEnvVars = false,
    currentApiKeys = null,
  }: {
    useOnlyEnvVars?: boolean;
    currentApiKeys?: AiProviderApiKeys | null;
  } = {},
) => {
  getConfig.mockImplementation((key: string) => {
    if (key === 'env:useOnlyEnvVars:ai') return useOnlyEnvVars;
    return undefined;
  });
  // The CURRENT merged (DB ?? env) view of the per-provider keys — the source of
  // truth for the apiKey merge, read at save time through the shape-guarded accessor.
  // undefined models "no usable stored keys" (unset OR a malformed value the guard
  // rejected), which buildUpdates treats as {}.
  readProviderApiKeys.mockReturnValue(currentApiKeys ?? undefined);

  const req = mock<CrowiRequest>();
  // express-validator + apiV3FormValidator run as middleware before this handler,
  // so the handler trusts req.body as the validated request.
  req.body = body;

  const res = mock<ApiV3Response>();
  res.locals = { activity: { _id: ACTIVITY_ID } };

  // putAiSettingsFactory returns the full middleware chain; the terminal handler
  // (whose mapping/side-effects we assert) is the LAST element.
  const chain = putAiSettingsFactory(buildCrowi());
  const handler = chain[chain.length - 1] as (
    req: CrowiRequest,
    res: ApiV3Response,
  ) => Promise<void>;
  await handler(req, res);
  return { res };
};

// Pull the `updates` object handed to the nth updateConfigs call.
const updatesAt = (index = 0): Record<string, unknown> =>
  updateConfigs.mock.calls[index][0];

// Convenience for the single-call cases: asserts updateConfigs ran exactly once.
const updates = (): Record<string, unknown> => {
  expect(updateConfigs).toHaveBeenCalledTimes(1);
  return updatesAt(0);
};

// The persisted ai:providers value, narrowed to a record for assertions. isRecord
// both drops the cast AND asserts the handler wrote an object (not undefined), so
// the per-provider reads below are typed (`unknown`, which `expect().toEqual`
// accepts) without asserting the full AiProvidersConfig shape.
const providersUpdateOf = (
  updates: Record<string, unknown>,
): Record<string, unknown> => {
  const value = updates['ai:providers'];
  if (!isRecord(value)) {
    throw new Error('expected ai:providers to be written as an object');
  }
  return value;
};

beforeEach(() => {
  vi.clearAllMocks();
  updateConfigs.mockResolvedValue(undefined);
});

describe('putAiSettings (multi-provider)', () => {
  describe('env-only mode split (Req 5.2, 5.3)', () => {
    it('rejects with 400 and persists nothing when env-only and providers present (5.2)', async () => {
      const { res } = await invoke(
        { providers: providersRequest({ google: { apiKey: 'x' } }) },
        { useOnlyEnvVars: true },
      );

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(apiv3Err.mock.calls[0][1]).toBe(400);
      expect(updateConfigs).not.toHaveBeenCalled();
      expect(clearResolvedMastraModelCache).not.toHaveBeenCalled();
      expect(clearAvailabilityLogDedup).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('rejects with 400 when env-only and aiEnabled present (5.2)', async () => {
      const { res } = await invoke(
        { aiEnabled: true },
        { useOnlyEnvVars: true },
      );

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(apiv3Err.mock.calls[0][1]).toBe(400);
      expect(updateConfigs).not.toHaveBeenCalled();
    });

    it('accepts an allowedModels-only request under env-only and saves only allowedModels (5.3)', async () => {
      const { res } = await invoke(
        {
          allowedModels: [
            { provider: 'openai', modelId: 'gpt-5', isDefault: true },
          ],
        },
        { useOnlyEnvVars: true },
      );

      expect(res.apiv3Err).not.toHaveBeenCalled();
      const saved = updates();
      expect(saved).toHaveProperty('ai:allowedModels');
      expect(saved).not.toHaveProperty('ai:providers');
      expect(saved).not.toHaveProperty('app:aiEnabled');
      expect(saved).not.toHaveProperty('ai:providerApiKeys');
    });
  });

  describe('field-to-config mapping on success', () => {
    it('maps aiEnabled, providers (enabled + azure) and allowedModels to the new config keys', async () => {
      const { res } = await invoke({
        aiEnabled: true,
        providers: providersRequest({
          openai: { enabled: true, apiKey: 'sk-openai' },
          'azure-openai': {
            enabled: true,
            apiKey: 'sk-azure',
            azureOpenaiSettings: { resourceName: 'my-res', useEntraId: true },
          },
        }),
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-5', isDefault: true },
        ],
      });

      const saved = updates();
      expect(saved['app:aiEnabled']).toBe(true);
      expect(saved['ai:providers']).toEqual({
        openai: { enabled: true },
        anthropic: { enabled: false },
        google: { enabled: false },
        'azure-openai': {
          enabled: true,
          azureOpenaiSettings: { resourceName: 'my-res', useEntraId: true },
        },
      });
      expect(saved['ai:providerApiKeys']).toEqual({
        openai: 'sk-openai',
        'azure-openai': 'sk-azure',
      });
      expect(saved['ai:allowedModels']).toEqual([
        { provider: 'openai', modelId: 'gpt-5', isDefault: true },
      ]);

      // The legacy single-provider keys are never written (Req 7.1).
      expect(saved).not.toHaveProperty('ai:provider');
      expect(saved).not.toHaveProperty('ai:apiKey');
      expect(saved).not.toHaveProperty('ai:azureOpenaiSettings');

      // Success side effects: cache invalidation + dedup reset + audit + 200.
      expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
      expect(clearAvailabilityLogDedup).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('update', ACTIVITY_ID, {
        action: SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE,
      });
      expect(res.apiv3).toHaveBeenCalledTimes(1);
    });

    it('writes ai:providers only when providers is present (omit = unchanged)', async () => {
      await invoke({ aiEnabled: false });
      expect(updates()).not.toHaveProperty('ai:providers');
    });
  });

  describe('Azure OpenAI connection settings (full-state replace)', () => {
    it('omits useEntraId when false and drops empty/cleared strings', async () => {
      await invoke({
        providers: providersRequest({
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: 'my-res',
              baseURL: '',
              apiVersion: undefined,
              useEntraId: false,
            },
          },
        }),
      });

      const providers = providersUpdateOf(updates());
      expect(providers['azure-openai']).toEqual({
        enabled: true,
        azureOpenaiSettings: { resourceName: 'my-res' },
      });
    });

    it('omits azureOpenaiSettings entirely when every field is empty', async () => {
      await invoke({
        providers: providersRequest({
          'azure-openai': { enabled: true, azureOpenaiSettings: {} },
        }),
      });

      const providers = providersUpdateOf(updates());
      expect(providers['azure-openai']).toEqual({ enabled: true });
    });
  });

  // The apiKey merge is the single write-only exception to full-state replace: an
  // empty/omitted key keeps the stored value (no clear operation), and the merge's
  // "current value" is the merged (DB ?? env) view read at SAVE time.
  describe('apiKey merge exception (Req 1.3, 1.4)', () => {
    it('does NOT write ai:providerApiKeys when no provider sends a non-empty key (toggle/model-only save)', async () => {
      // An env-provided key exists for openai; a toggle-only save must not
      // duplicate it into the DB (env fallback stays intact).
      await invoke(
        { providers: providersRequest({ openai: { enabled: true } }) },
        { currentApiKeys: { openai: 'env-openai-key' } },
      );

      expect(updates()).not.toHaveProperty('ai:providerApiKeys');
    });

    it('treats a whitespace-only apiKey as empty: keeps the stored key instead of persisting a blank', async () => {
      // A stray space must follow the merge exception (keep the stored value) exactly
      // like an omitted key — never persisted as a "set" key that reads back as
      // configured yet 401s at the provider.
      await invoke(
        { providers: providersRequest({ openai: { apiKey: '   ' } }) },
        { currentApiKeys: { openai: 'env-openai-key' } },
      );

      expect(updates()).not.toHaveProperty('ai:providerApiKeys');
    });

    it('persists a key with surrounding whitespace trimmed (not verbatim)', async () => {
      // A key pasted with a trailing newline / leading spaces passes the non-empty
      // check; it must be stored trimmed so it does not read back as configured yet
      // fail at the provider (401 / invalid-header) with the raw whitespace.
      await invoke({
        providers: providersRequest({ openai: { apiKey: '  sk-openai\n' } }),
      });

      expect(updates()['ai:providerApiKeys']).toMatchObject({
        openai: 'sk-openai',
      });
    });

    it('carries other providers keys forward from the merged view when one non-empty key is sent', async () => {
      await invoke(
        { providers: providersRequest({ google: { apiKey: 'sk-google' } }) },
        {
          currentApiKeys: {
            openai: 'env-openai',
            anthropic: 'env-anthropic',
          },
        },
      );

      // The new key is merged over the current merged view — env-derived keys for
      // providers not in this request are preserved (Req 1.4), none is cleared.
      expect(updates()['ai:providerApiKeys']).toEqual({
        openai: 'env-openai',
        anthropic: 'env-anthropic',
        google: 'sk-google',
      });
    });

    it('merges over the SHAPE-GUARDED view, not raw getConfig, so a malformed stored value cannot become junk', async () => {
      // readProviderApiKeys returns undefined for a malformed but valid-JSON config
      // (e.g. an array/string from a hand-edited AI_PROVIDER_API_KEYS). The merge
      // must then be over {}, writing ONLY the request key — never index-keyed junk
      // (e.g. { '0': 's', '1': 'k', ..., openai: '...' }) from spreading a raw value.
      readProviderApiKeys.mockReturnValue(undefined);

      await invoke({
        providers: providersRequest({ openai: { apiKey: 'sk-openai' } }),
      });

      expect(updates()['ai:providerApiKeys']).toEqual({ openai: 'sk-openai' });
      // The guarded accessor is the read path; raw getConfig is never used for keys.
      expect(readProviderApiKeys).toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalledWith('ai:providerApiKeys');
    });

    it('preserves an unrelated providers stored key when only one provider key is updated (independent update, Req 1.3)', async () => {
      await invoke(
        {
          providers: providersRequest({ openai: { apiKey: 'sk-new-openai' } }),
        },
        { currentApiKeys: { anthropic: 'sk-existing-anthropic' } },
      );

      expect(updates()['ai:providerApiKeys']).toEqual({
        anthropic: 'sk-existing-anthropic',
        openai: 'sk-new-openai',
      });
    });

    it('reads the CURRENT merged view at save time: two sequential PUTs leave BOTH keys present', async () => {
      // PUT 1: openai key only; merged view starts empty.
      await invoke({
        providers: providersRequest({ openai: { apiKey: 'sk-openai' } }),
      });
      expect(updatesAt(0)['ai:providerApiKeys']).toEqual({
        openai: 'sk-openai',
      });

      // PUT 2: anthropic key only. The merged view now reflects PUT 1's write
      // (persistence simulated via currentApiKeys) — proving the merge base is
      // read at SAVE time, not reconstructed from a stale GET snapshot.
      await invoke(
        {
          providers: providersRequest({
            anthropic: { apiKey: 'sk-anthropic' },
          }),
        },
        { currentApiKeys: { openai: 'sk-openai' } },
      );
      expect(updatesAt(1)['ai:providerApiKeys']).toEqual({
        openai: 'sk-openai',
        anthropic: 'sk-anthropic',
      });
    });
  });

  describe('disable preserves credentials & settings (Req 1.6)', () => {
    it('writes enabled:false but does not clear the providers key or azure settings on disable', async () => {
      await invoke(
        {
          providers: providersRequest({
            'azure-openai': {
              enabled: false,
              azureOpenaiSettings: { resourceName: 'my-res' },
            },
          }),
        },
        { currentApiKeys: { 'azure-openai': 'stored-azure-key' } },
      );

      const saved = updates();
      const providers = providersUpdateOf(saved);
      expect(providers['azure-openai']).toEqual({
        enabled: false,
        azureOpenaiSettings: { resourceName: 'my-res' },
      });
      // No non-empty apiKey was sent, so the stored key is left untouched.
      expect(saved).not.toHaveProperty('ai:providerApiKeys');
    });
  });

  describe('allowedModels replace / clear (Req 1.3, 2.9, 3.3)', () => {
    it('omits ai:allowedModels when allowedModels is not provided (unchanged)', async () => {
      await invoke({ providers: providersRequest() });
      expect(updates()).not.toHaveProperty('ai:allowedModels');
    });

    it('stores an empty array verbatim as [] (no collapse to env fallback, Req 3.3)', async () => {
      await invoke({ allowedModels: [] });

      const saved = updates();
      expect(saved).toHaveProperty('ai:allowedModels');
      expect(saved['ai:allowedModels']).toEqual([]);
    });

    it('stores a non-empty allow-list verbatim, incl. isDefault and providerOptions (Req 1.3)', async () => {
      await invoke({
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-5',
            isDefault: true,
            providerOptions: { openai: { temperature: 0.2 } },
          },
          { provider: 'anthropic', modelId: 'claude-sonnet-5' },
        ],
      });

      expect(updates()['ai:allowedModels']).toEqual([
        {
          provider: 'openai',
          modelId: 'gpt-5',
          isDefault: true,
          providerOptions: { openai: { temperature: 0.2 } },
        },
        { provider: 'anthropic', modelId: 'claude-sonnet-5' },
      ]);
    });

    it('saves allowed models for a provider with no credentials (Req 2.9)', async () => {
      await invoke({
        allowedModels: [
          { provider: 'google', modelId: 'gemini-2.0', isDefault: true },
        ],
      });

      const saved = updates();
      expect(saved['ai:allowedModels']).toEqual([
        { provider: 'google', modelId: 'gemini-2.0', isDefault: true },
      ]);
      // Model editing is independent of any connection settings.
      expect(saved).not.toHaveProperty('ai:providers');
      expect(saved).not.toHaveProperty('ai:providerApiKeys');
    });
  });

  describe('error handling (Req 1.9)', () => {
    it('answers apiv3Err and never leaks the apiKey when persistence fails', async () => {
      updateConfigs.mockRejectedValue(new Error('db write failed'));

      const { res } = await invoke({
        providers: providersRequest({ openai: { apiKey: 'sk-leak-me-not' } }),
      });

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(res.apiv3).not.toHaveBeenCalled();
      // Sweep the WHOLE error response (every argument, serialized), not just
      // `.message`, so the key cannot hide in a non-message field of the ErrorV3.
      const serializedErrResponse = JSON.stringify(apiv3Err.mock.calls[0]);
      expect(serializedErrResponse).not.toContain('sk-leak-me-not');
      // The catch-path log must never carry the key either (Req 1.9). Assert the
      // handler logged the failure (so the assertion is real) and sweep every arg.
      expect(loggerError).toHaveBeenCalled();
      const serializedLogs = JSON.stringify(
        loggerError.mock.calls.map((call) =>
          call.map((arg) => (arg instanceof Error ? arg.message : arg)),
        ),
      );
      expect(serializedLogs).not.toContain('sk-leak-me-not');
      // No side effects on failure.
      expect(emit).not.toHaveBeenCalled();
      expect(clearResolvedMastraModelCache).not.toHaveBeenCalled();
      expect(clearAvailabilityLogDedup).not.toHaveBeenCalled();
    });
  });
});

// --- updateAiSettingsValidators --------------------------------------------
//
// The validator chain enforces the FORMAL request shape before the handler runs.
// We assert its observable contract (accept / reject of a field) by driving the
// real express-validator engine over a fake request and inspecting validationResult,
// rather than the chain's internal structure.

// Build a minimal Express-like request the express-validator engine accepts.
const buildRequest = (body: Record<string, unknown>): Request =>
  ({
    body,
    cookies: {},
    headers: {},
    params: {},
    query: {},
  }) as unknown as Request;

const runValidators = async (
  body: Record<string, unknown>,
): Promise<{ hasErrors: boolean; failedFields: string[] }> => {
  const req = buildRequest(body);
  await Promise.all(updateAiSettingsValidators.map((chain) => chain.run(req)));
  const result = validationResult(req);
  return {
    hasErrors: !result.isEmpty(),
    failedFields: result.array().map((e) => e.param),
  };
};

describe('updateAiSettingsValidators', () => {
  describe('aiEnabled', () => {
    it('accepts a boolean value', async () => {
      expect((await runValidators({ aiEnabled: true })).hasErrors).toBe(false);
      expect((await runValidators({ aiEnabled: false })).hasErrors).toBe(false);
    });

    it('rejects a non-boolean value', async () => {
      const { hasErrors, failedFields } = await runValidators({
        aiEnabled: 'yes',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('aiEnabled');
    });

    it('accepts a request that omits aiEnabled', async () => {
      expect((await runValidators({})).hasErrors).toBe(false);
    });
  });

  // The new rule (design "a providers request must include all 4 provider entries"):
  // a `providers` object, when present, must carry an entry for EVERY supported
  // provider (fixed-slot model). A missing entry is a 400.
  describe('providers (all 4 entries required)', () => {
    it('accepts a providers object with all 4 entries', async () => {
      const { hasErrors } = await runValidators({
        providers: providersRequest(),
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts a providers object whose entries carry enabled/apiKey/azure settings', async () => {
      const { hasErrors } = await runValidators({
        providers: providersRequest({
          openai: { enabled: true, apiKey: 'sk-openai' },
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: 'my-res',
              apiVersion: '2024-02-01',
              useEntraId: true,
            },
          },
        }),
      });
      expect(hasErrors).toBe(false);
    });

    it('rejects a providers object missing one of the 4 entries', async () => {
      const { hasErrors, failedFields } = await runValidators({
        // missing 'azure-openai'
        providers: { openai: {}, anthropic: {}, google: {} },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providers');
    });

    it('rejects a non-object providers value', async () => {
      const { hasErrors, failedFields } = await runValidators({
        providers: 'not-an-object',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providers');
    });

    // All four entries are present here; the rejection is driven by a wrong-typed
    // field, not a missing slot. These invalid payloads are client-supplied JSON,
    // so they are built as raw literals (runValidators takes Record<string, unknown>)
    // rather than through the typed providersRequest helper.
    it('rejects an entry with a non-boolean enabled', async () => {
      const { hasErrors, failedFields } = await runValidators({
        providers: {
          openai: { enabled: 'yes' },
          anthropic: {},
          google: {},
          'azure-openai': {},
        },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providers');
    });

    it('rejects an entry with a non-string apiKey', async () => {
      const { hasErrors, failedFields } = await runValidators({
        providers: {
          openai: { apiKey: 123 },
          anthropic: {},
          google: {},
          'azure-openai': {},
        },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providers');
    });

    it('rejects an entry with a non-string azure connection string', async () => {
      const { hasErrors, failedFields } = await runValidators({
        providers: {
          openai: {},
          anthropic: {},
          google: {},
          'azure-openai': { azureOpenaiSettings: { resourceName: 123 } },
        },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providers');
    });

    it('accepts a request that omits providers (unchanged)', async () => {
      expect((await runValidators({})).hasErrors).toBe(false);
    });
  });

  // allowedModels is validated as a WHOLE array against the shared pure predicate
  // (the per-entry + cross-field invariants cannot be expressed by per-field
  // chains). Each entry now needs a (provider, modelId) pair.
  describe('allowedModels (whole-array invariants)', () => {
    it('accepts a valid non-empty allow-list (exactly one default, valid options)', async () => {
      const { hasErrors } = await runValidators({
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            isDefault: true,
            providerOptions: { openai: { temperature: 0.2 } },
          },
          { provider: 'openai', modelId: 'gpt-4o-mini' },
        ],
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts the same modelId under DIFFERENT providers (Req 2.3)', async () => {
      const { hasErrors } = await runValidators({
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
          { provider: 'azure-openai', modelId: 'gpt-4o' },
        ],
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts an empty array (the clear path — must NOT fail, Req 3.3)', async () => {
      expect((await runValidators({ allowedModels: [] })).hasErrors).toBe(
        false,
      );
    });

    it('accepts a request that omits allowedModels', async () => {
      expect((await runValidators({})).hasErrors).toBe(false);
    });

    it('rejects a non-array allowedModels', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: { provider: 'openai', modelId: 'gpt-4o' },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a duplicate (provider, modelId) pair (Req 2.4)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
          { provider: 'openai', modelId: 'gpt-4o' },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects an unsupported provider (Req 2.5)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          { provider: 'bedrock', modelId: 'claude', isDefault: true },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a non-empty list with an empty modelId', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [{ provider: 'openai', modelId: '', isDefault: true }],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a list with zero defaults (Req 3.2)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-4o' },
          { provider: 'openai', modelId: 'gpt-4o-mini' },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a list with two defaults (Req 3.2)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
          { provider: 'openai', modelId: 'gpt-4o-mini', isDefault: true },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects an entry with non-namespaced providerOptions (Req 2.8)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            isDefault: true,
            providerOptions: { temperature: 0.2 },
          },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });
  });

  it('accepts a fully populated valid request', async () => {
    const { hasErrors } = await runValidators({
      aiEnabled: true,
      providers: providersRequest({
        openai: { enabled: true, apiKey: 'secret-key' },
        'azure-openai': {
          enabled: true,
          apiKey: 'azure-key',
          azureOpenaiSettings: {
            resourceName: 'my-resource',
            baseURL: 'https://example.openai.azure.com',
            apiVersion: '2024-02-01',
            useEntraId: false,
          },
        },
      }),
      allowedModels: [
        { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
        { provider: 'azure-openai', modelId: 'prod-deployment' },
      ],
    });
    expect(hasErrors).toBe(false);
  });
});
