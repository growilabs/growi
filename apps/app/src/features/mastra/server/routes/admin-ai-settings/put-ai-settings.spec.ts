// --- Mock boundary ---------------------------------------------------------
//
// putAiSettings persists the submitted AI configuration. Its observable contract
// is a set of side effects at three boundaries plus the env-only guard:
//   - configManager.getConfig('env:useOnlyEnvVars:ai'): when true the update is
//     rejected with 422 and NOTHING is persisted (Req 4.3).
//   - configManager.updateConfigs(updates, options): the persistence boundary.
//     The contract is the SHAPE of `updates` (which keys, with what values) and
//     the `removeIfUndefined` option:
//       * the clearable provider string normalizes '' -> undefined and is removed
//         from DB so the effective value falls back to the env var (Req 4.4)
//       * ai:allowedModels is the per-model allow-list (full-state replace): a
//         non-empty (validated) array is persisted verbatim incl. isDefault and
//         providerOptions (Req 1.1/1.3); an empty/omitted array collapses to
//         undefined so removeIfUndefined deletes the key and getConfig falls back
//         to [] — the legitimate "no allowed models" clear path (Req 1.1)
//       * the four Azure OpenAI fields are consolidated into one ai:azureOpenaiSettings
//         JSON object (full-state replace); useEntraId is stored only when true,
//         and an all-cleared object collapses to undefined so removeIfUndefined
//         deletes the key and the value falls back to the env var (Req 4.4)
//       * app:aiEnabled is saved only when provided
//       * ai:apiKey is the exception: present only when a non-empty value is sent,
//         omitted otherwise so the stored key is preserved (Req 5.x) — UNLESS the
//         provider changes without a new key, in which case it is cleared
//         (undefined) so the previous provider's secret is not reused against the
//         new provider (security)
//   - clearResolvedMastraModelCache(): invalidated on success so the next request
//     rebuilds the model from the new config without a restart (Req 2.4).
//   - activityEvent.emit('update', activity._id, { action }): audit log (Req 2.3).
//   - on failure: apiv3Err is answered and the apiKey value never reaches the
//     error message or the log (Req 5.3).
// We mock the collaborators so the test exercises only this handler's mapping and
// side effects, not how a value is persisted or how the model is built.
const { getConfig, updateConfigs } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfigs: vi.fn(),
}));
const { clearResolvedMastraModelCache } = vi.hoisted(() => ({
  clearResolvedMastraModelCache: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig, updateConfigs },
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model',
  () => ({
    clearResolvedMastraModelCache,
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
import type { AiSettingsUpdateRequest } from '../../../interfaces/ai-settings';
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

const invoke = async (
  body: AiSettingsUpdateRequest,
  {
    useOnlyEnvVars = false,
    currentProvider,
  }: { useOnlyEnvVars?: boolean; currentProvider?: AiProvider } = {},
) => {
  getConfig.mockImplementation((key: string) => {
    if (key === 'env:useOnlyEnvVars:ai') return useOnlyEnvVars;
    // Currently stored provider — drives the apiKey provider-change invalidation.
    if (key === 'ai:provider') return currentProvider;
    return undefined;
  });

  const req = mock<CrowiRequest>();
  // express-validator + apiV3FormValidator run as middleware before this handler,
  // so the handler trusts req.body as the validated request.
  req.body = body;

  const res = mock<ApiV3Response>();
  res.locals = { activity: { _id: ACTIVITY_ID } };

  // putAiSettingsFactory now returns the full middleware chain; the terminal
  // handler (whose mapping/side-effects we assert) is the LAST element.
  const chain = putAiSettingsFactory(buildCrowi());
  const handler = chain[chain.length - 1] as (
    req: CrowiRequest,
    res: ApiV3Response,
  ) => Promise<void>;
  await handler(req, res);
  return { res };
};

// Pull the (updates, options) pair handed to updateConfigs.
const updateCall = (): [
  Record<string, unknown>,
  { removeIfUndefined?: boolean }?,
] => {
  expect(updateConfigs).toHaveBeenCalledTimes(1);
  return updateConfigs.mock.calls[0] as [
    Record<string, unknown>,
    { removeIfUndefined?: boolean }?,
  ];
};

beforeEach(() => {
  vi.clearAllMocks();
  updateConfigs.mockResolvedValue(undefined);
});

describe('putAiSettings (Req 2.3, 2.4, 4.3, 4.4, 5.3, 7.1)', () => {
  describe('env-only mode (Req 4.3)', () => {
    it('rejects with 422 and persists nothing when env:useOnlyEnvVars:ai is true', async () => {
      const { res } = await invoke(
        {
          provider: 'openai',
          allowedModels: [{ model: 'gpt-4o', isDefault: true }],
        },
        { useOnlyEnvVars: true },
      );

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(apiv3Err.mock.calls[0][1]).toBe(422);
      expect(updateConfigs).not.toHaveBeenCalled();
      expect(clearResolvedMastraModelCache).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('successful save (Req 1.1, 1.2, 1.3, 2.3, 7.1)', () => {
    it('maps fields (incl. the allowedModels allow-list) to config keys, clears the cache, and emits the audit action', async () => {
      const { res } = await invoke({
        aiEnabled: true,
        provider: 'openai',
        apiKey: 'sk-new-key',
        allowedModels: [
          {
            model: 'gpt-4o',
            isDefault: true,
            providerOptions: { openai: { temperature: 0.2 } },
          },
          { model: 'gpt-4o-mini' },
        ],
        azureOpenaiSettings: { useEntraId: true },
      });

      const [updates] = updateCall();
      expect(updates).toMatchObject({
        'app:aiEnabled': true,
        'ai:provider': 'openai',
        'ai:apiKey': 'sk-new-key',
        // The per-model allow-list is persisted verbatim (incl. isDefault and
        // providerOptions) — Req 1.1, 1.3.
        'ai:allowedModels': [
          {
            model: 'gpt-4o',
            isDefault: true,
            providerOptions: { openai: { temperature: 0.2 } },
          },
          { model: 'gpt-4o-mini' },
        ],
        // The azureOpenaiSettings object is re-assembled into the config value.
        'ai:azureOpenaiSettings': { useEntraId: true },
      });
      // The legacy single-model keys are no longer written.
      expect(updates).not.toHaveProperty('ai:model');
      expect(updates).not.toHaveProperty('ai:providerOptions');

      // The resolved-model cache is invalidated AFTER the save so the next request
      // rebuilds from the new allow-list without a restart (Req 1.2).
      expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('update', ACTIVITY_ID, {
        action: SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE,
      });
      expect(res.apiv3).toHaveBeenCalledTimes(1);
    });
  });

  // The clear path: an empty array OR an omitted allowedModels collapses to
  // undefined so removeIfUndefined deletes ai:allowedModels and getConfig falls
  // back to its default []. This is a legitimate "no allowed models" disablement,
  // NOT a 422 (Req 1.1) — and it must mirror the azureOpenaiSettings collapse.
  describe('allowedModels clear path (Req 1.1)', () => {
    it('collapses an empty array to undefined (key present for removeIfUndefined)', async () => {
      await invoke({ provider: 'openai', allowedModels: [] });

      const [updates, options] = updateCall();
      expect(updates).toHaveProperty('ai:allowedModels');
      expect(updates['ai:allowedModels']).toBeUndefined();
      expect(options).toMatchObject({ removeIfUndefined: true });
    });

    it('collapses an omitted allowedModels to undefined (key present for removeIfUndefined)', async () => {
      await invoke({ provider: 'openai' });

      const [updates, options] = updateCall();
      expect(updates).toHaveProperty('ai:allowedModels');
      expect(updates['ai:allowedModels']).toBeUndefined();
      expect(options).toMatchObject({ removeIfUndefined: true });
    });

    it('still clears the cache and emits the audit action on a clear-path save (Req 1.2)', async () => {
      const { res } = await invoke({ provider: 'openai', allowedModels: [] });

      expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(res.apiv3).toHaveBeenCalledTimes(1);
    });

    it('persists a non-empty allow-list verbatim (no collapse)', async () => {
      await invoke({
        provider: 'openai',
        allowedModels: [{ model: 'gpt-4o', isDefault: true }],
      });

      const [updates] = updateCall();
      expect(updates['ai:allowedModels']).toEqual([
        { model: 'gpt-4o', isDefault: true },
      ]);
    });
  });

  describe('apiKey preservation (Req 5.x)', () => {
    it('omits ai:apiKey from updates when apiKey is undefined (existing key preserved)', async () => {
      // Same provider as stored: the merge ("keep existing") applies.
      await invoke({ provider: 'openai' }, { currentProvider: 'openai' });

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });

    it('omits ai:apiKey from updates when apiKey is an empty string (existing key preserved)', async () => {
      await invoke(
        { provider: 'openai', apiKey: '' },
        { currentProvider: 'openai' },
      );

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });

    it('includes ai:apiKey only when a non-empty value is provided', async () => {
      await invoke({ apiKey: 'sk-set-me' });

      const [updates] = updateCall();
      expect(updates['ai:apiKey']).toBe('sk-set-me');
    });
  });

  // SECURITY: ai:apiKey is a single key shared by every provider. If the admin
  // switches provider without entering a new key, the merge would carry the
  // previous provider's secret over — and the next chat request would transmit it
  // to a different vendor's endpoint (e.g. an OpenAI key sent to Google). The
  // handler must clear the stored key on a provider change unless a new one is set.
  describe('apiKey invalidation on provider change (security)', () => {
    it('clears ai:apiKey (present-but-undefined for removeIfUndefined) when the provider changes and no new key is sent', async () => {
      await invoke({ provider: 'google' }, { currentProvider: 'openai' });

      const [updates, options] = updateCall();
      expect(updates).toHaveProperty('ai:apiKey');
      expect(updates['ai:apiKey']).toBeUndefined();
      // removeIfUndefined then deletes the stored key from the DB.
      expect(options).toMatchObject({ removeIfUndefined: true });
    });

    it('persists the new key (does NOT clear) when the provider changes and a new key is sent', async () => {
      await invoke(
        {
          provider: 'google',
          apiKey: 'new-google-key',
        },
        { currentProvider: 'openai' },
      );

      const [updates] = updateCall();
      expect(updates['ai:apiKey']).toBe('new-google-key');
    });

    it('preserves the stored key (omits ai:apiKey) when the provider is unchanged', async () => {
      await invoke({ provider: 'openai' }, { currentProvider: 'openai' });

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });
  });

  // The handler receives ALREADY-sanitized input: the validator's customSanitizer
  // (middleware) has turned cleared strings into `undefined` before the handler
  // runs. These tests invoke the handler directly (bypassing the middleware), so
  // they feed `undefined` to represent a post-sanitizer cleared field. The
  // sanitizer's own '' -> undefined behavior is covered in the validators block.
  describe('cleared fields with removeIfUndefined (Req 4.4)', () => {
    it('keeps cleared (undefined) keys present so removeIfUndefined deletes them from the DB', async () => {
      await invoke({
        provider: 'openai',
        allowedModels: undefined,
        azureOpenaiSettings: {},
      });

      const [updates, options] = updateCall();
      expect(options).toMatchObject({ removeIfUndefined: true });
      // Omitted allow-list -> collapses to undefined (clear path).
      expect(updates['ai:allowedModels']).toBeUndefined();
      // All Azure fields cleared (and useEntraId not provided) -> the object
      // collapses to undefined so removeIfUndefined deletes the consolidated key.
      expect(updates['ai:azureOpenaiSettings']).toBeUndefined();
      // Non-empty string keeps its value.
      expect(updates['ai:provider']).toBe('openai');
      // The keys are still present in the updates object so removeIfUndefined deletes them.
      expect(updates).toHaveProperty('ai:allowedModels');
      expect(updates).toHaveProperty('ai:azureOpenaiSettings');
    });

    it('keeps a non-empty provider value', async () => {
      await invoke({ provider: 'anthropic' });

      const [updates] = updateCall();
      expect(updates['ai:provider']).toBe('anthropic');
    });

    it('saves app:aiEnabled even when false', async () => {
      await invoke({ aiEnabled: false });

      const [updates] = updateCall();
      expect(updates['app:aiEnabled']).toBe(false);
    });
  });

  // The azureOpenaiSettings object is re-assembled into the ai:azureOpenaiSettings
  // config value. It is full-state replace: useEntraId is stored only when true,
  // and an object with no meaningful content collapses to undefined so
  // removeIfUndefined deletes the key and the value falls back to the
  // AI_AZURE_OPENAI_SETTINGS env default (Req 4.4, at the object level).
  describe('Azure OpenAI object consolidation (Req 4.4)', () => {
    it('builds the ai:azureOpenaiSettings config from the request object', async () => {
      await invoke({
        azureOpenaiSettings: {
          resourceName: 'my-resource',
          apiVersion: '2024-02-01',
          useEntraId: true,
        },
      });

      const [updates] = updateCall();
      expect(updates['ai:azureOpenaiSettings']).toEqual({
        resourceName: 'my-resource',
        apiVersion: '2024-02-01',
        useEntraId: true,
      });
    });

    it('omits useEntraId from the object when it is false (default carries no info)', async () => {
      await invoke({
        azureOpenaiSettings: { resourceName: 'my-resource', useEntraId: false },
      });

      const [updates] = updateCall();
      expect(updates['ai:azureOpenaiSettings']).toEqual({
        resourceName: 'my-resource',
      });
    });

    it('collapses to undefined (key present for removeIfUndefined) when every field is cleared', async () => {
      await invoke({
        azureOpenaiSettings: {
          resourceName: undefined,
          baseURL: undefined,
          apiVersion: undefined,
          useEntraId: false,
        },
      });

      const [updates, options] = updateCall();
      expect(updates).toHaveProperty('ai:azureOpenaiSettings');
      expect(updates['ai:azureOpenaiSettings']).toBeUndefined();
      expect(options).toMatchObject({ removeIfUndefined: true });
    });
  });

  describe('error handling (Req 5.3)', () => {
    it('answers apiv3Err and does not leak the apiKey when persistence fails', async () => {
      updateConfigs.mockRejectedValue(new Error('db write failed'));

      const { res } = await invoke({ apiKey: 'sk-leak-me-not' });

      const apiv3Err = vi.mocked(res.apiv3Err);
      expect(apiv3Err).toHaveBeenCalledTimes(1);
      expect(res.apiv3).not.toHaveBeenCalled();
      const errArg = apiv3Err.mock.calls[0][0];
      const message =
        typeof errArg === 'string'
          ? errArg
          : String((errArg as { message?: unknown })?.message ?? '');
      expect(message).not.toContain('sk-leak-me-not');
      // The audit event must not fire on failure.
      expect(emit).not.toHaveBeenCalled();
    });
  });
});

// --- updateAiSettingsValidators (Req 6.1, 6.2) -----------------------------
//
// The validator chain enforces the FORMAL request shape before the handler runs.
// We assert its observable contract (accept / reject of a field) by driving the
// real express-validator engine over a fake request and inspecting validationResult,
// rather than the chain's internal structure.

// Build a minimal Express-like request the express-validator engine accepts.
// Only `body` carries real data; the other locations are present so the engine
// can traverse them without throwing.
const buildRequest = (body: Record<string, unknown>): Request =>
  ({
    body,
    cookies: {},
    headers: {},
    params: {},
    query: {},
  }) as unknown as Request;

// Run the full chain against a request body and report whether the engine
// accumulated errors, plus which fields failed. Also returns the (possibly
// sanitizer-mutated) req.body so tests can assert the customSanitizer's
// write-back ('' -> undefined) that the production middleware applies before
// the handler runs.
const runValidators = async (
  body: Record<string, unknown>,
): Promise<{
  hasErrors: boolean;
  failedFields: string[];
  body: Record<string, unknown>;
}> => {
  const req = buildRequest(body);
  await Promise.all(updateAiSettingsValidators.map((chain) => chain.run(req)));
  const result = validationResult(req);
  return {
    hasErrors: !result.isEmpty(),
    failedFields: result.array().map((e) => e.param),
    body: req.body,
  };
};

describe('updateAiSettingsValidators (Req 6.1, 6.2)', () => {
  describe('provider', () => {
    it.each([
      'openai',
      'anthropic',
      'google',
      'azure-openai',
    ])('accepts the supported provider "%s"', async (provider) => {
      const { hasErrors } = await runValidators({ provider });
      expect(hasErrors).toBe(false);
    });

    it('rejects an unsupported provider value', async () => {
      const { hasErrors, failedFields } = await runValidators({
        provider: 'bedrock',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('provider');
    });

    it('accepts a request that omits provider (optional / partial update)', async () => {
      const { hasErrors } = await runValidators({});
      expect(hasErrors).toBe(false);
    });
  });

  // allowedModels is validated as a WHOLE array (the per-entry + cross-field
  // invariants cannot be expressed by per-field chains). It rejects with the
  // `allowedModels` field flagged when non-array, a non-empty list breaks a rule,
  // or the default count != 1. An empty array is ACCEPTED (the clear path).
  describe('allowedModels (whole-array invariants, Req 1.3/1.4/1.5/2.4)', () => {
    it('accepts a valid non-empty allow-list (exactly one default, valid options)', async () => {
      const { hasErrors } = await runValidators({
        allowedModels: [
          {
            model: 'gpt-4o',
            isDefault: true,
            providerOptions: { openai: { temperature: 0.2 } },
          },
          { model: 'gpt-4o-mini' },
        ],
      });
      expect(hasErrors).toBe(false);
    });

    it('accepts an empty array (the clear path — must NOT 422, Req 1.1)', async () => {
      const { hasErrors } = await runValidators({ allowedModels: [] });
      expect(hasErrors).toBe(false);
    });

    it('accepts a request that omits allowedModels', async () => {
      const { hasErrors } = await runValidators({});
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-array allowedModels', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: { model: 'gpt-4o' },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects duplicate model ids (Req 1.4)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          { model: 'gpt-4o', isDefault: true },
          { model: 'gpt-4o' },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a non-empty list with an empty model id (Req 1.4)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [{ model: '', isDefault: true }],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a list with zero defaults (Req 1.5)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [{ model: 'gpt-4o' }, { model: 'gpt-4o-mini' }],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects a list with two defaults (Req 1.5)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          { model: 'gpt-4o', isDefault: true },
          { model: 'gpt-4o-mini', isDefault: true },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('rejects an entry with invalid (non-namespaced) providerOptions (Req 2.4)', async () => {
      const { hasErrors, failedFields } = await runValidators({
        allowedModels: [
          {
            model: 'gpt-4o',
            isDefault: true,
            providerOptions: { temperature: 0.2 },
          },
        ],
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('allowedModels');
    });

    it('accepts an entry with empty providerOptions ("no options", Req 2.3)', async () => {
      const { hasErrors } = await runValidators({
        allowedModels: [
          { model: 'gpt-4o', isDefault: true, providerOptions: {} },
        ],
      });
      expect(hasErrors).toBe(false);
    });
  });

  // The string fields are type-guarded with .isString(): a non-string value is
  // rejected, a string passes. The Azure connection strings live under the nested
  // azureOpenaiSettings object (validated by dot-path).
  describe('string type validation (.isString())', () => {
    it('rejects a non-string value for "apiKey"', async () => {
      const { hasErrors, failedFields } = await runValidators({ apiKey: 123 });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('apiKey');
    });

    it('accepts a string value for "apiKey"', async () => {
      const { hasErrors } = await runValidators({ apiKey: 'some-value' });
      expect(hasErrors).toBe(false);
    });

    it.each([
      'resourceName',
      'baseURL',
      'apiVersion',
    ])('rejects a non-string value for azureOpenaiSettings.%s', async (field) => {
      const { hasErrors, failedFields } = await runValidators({
        azureOpenaiSettings: { [field]: 123 },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain(`azureOpenaiSettings.${field}`);
    });

    it.each([
      'resourceName',
      'baseURL',
      'apiVersion',
    ])('accepts a string value for azureOpenaiSettings.%s', async (field) => {
      const { hasErrors } = await runValidators({
        azureOpenaiSettings: { [field]: 'some-value' },
      });
      expect(hasErrors).toBe(false);
    });

    it('rejects a non-object azureOpenaiSettings', async () => {
      const { hasErrors, failedFields } = await runValidators({
        azureOpenaiSettings: 'not-an-object',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('azureOpenaiSettings');
    });
  });

  // The clearable Azure connection string fields carry a customSanitizer that the
  // production middleware applies before the handler runs: '' -> undefined so that
  // removeIfUndefined deletes them and the value falls back to the env var
  // (Req 4.4). This is the only place that behavior is exercised — the handler
  // tests bypass the middleware, so they no longer see the normalization.
  describe('customSanitizer clears empty strings ("" -> undefined) (Req 4.4)', () => {
    it.each([
      'resourceName',
      'baseURL',
      'apiVersion',
    ])('sanitizes an empty azureOpenaiSettings.%s to undefined', async (field) => {
      const { hasErrors, body } = await runValidators({
        azureOpenaiSettings: { [field]: '' },
      });
      expect(hasErrors).toBe(false);
      const azure = body.azureOpenaiSettings as Record<string, unknown>;
      expect(azure[field]).toBeUndefined();
    });

    it('leaves a non-empty clearable Azure string untouched', async () => {
      const { body } = await runValidators({
        azureOpenaiSettings: { resourceName: 'my-resource' },
      });
      const azure = body.azureOpenaiSettings as Record<string, unknown>;
      expect(azure.resourceName).toBe('my-resource');
    });

    it('does NOT sanitize an empty apiKey to undefined (handled by the handler instead)', async () => {
      const { hasErrors, body } = await runValidators({ apiKey: '' });
      expect(hasErrors).toBe(false);
      expect(body.apiKey).toBe('');
    });
  });

  describe('boolean fields', () => {
    it('accepts a boolean value for aiEnabled', async () => {
      expect((await runValidators({ aiEnabled: true })).hasErrors).toBe(false);
      expect((await runValidators({ aiEnabled: false })).hasErrors).toBe(false);
    });

    it('rejects a non-boolean value for aiEnabled', async () => {
      const { hasErrors, failedFields } = await runValidators({
        aiEnabled: 'yes',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('aiEnabled');
    });

    it('accepts a boolean value for azureOpenaiSettings.useEntraId', async () => {
      expect(
        (await runValidators({ azureOpenaiSettings: { useEntraId: true } }))
          .hasErrors,
      ).toBe(false);
      expect(
        (await runValidators({ azureOpenaiSettings: { useEntraId: false } }))
          .hasErrors,
      ).toBe(false);
    });

    it('rejects a non-boolean value for azureOpenaiSettings.useEntraId', async () => {
      const { hasErrors, failedFields } = await runValidators({
        azureOpenaiSettings: { useEntraId: 'yes' },
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('azureOpenaiSettings.useEntraId');
    });
  });

  it('accepts a fully populated valid request', async () => {
    const { hasErrors } = await runValidators({
      aiEnabled: true,
      provider: 'azure-openai',
      apiKey: 'secret-key',
      allowedModels: [
        {
          model: 'gpt-4o',
          isDefault: true,
          providerOptions: { openai: { temperature: 0.2 } },
        },
        { model: 'gpt-4o-mini' },
      ],
      azureOpenaiSettings: {
        resourceName: 'my-resource',
        baseURL: 'https://example.openai.azure.com',
        apiVersion: '2024-02-01',
        useEntraId: false,
      },
    });
    expect(hasErrors).toBe(false);
  });
});
