// --- Mock boundary ---------------------------------------------------------
//
// putAiSettings persists the submitted AI configuration. Its observable contract
// is a set of side effects at three boundaries plus the env-only guard:
//   - configManager.getConfig('env:useOnlyEnvVars:ai'): when true the update is
//     rejected with 422 and NOTHING is persisted (Req 4.3).
//   - configManager.updateConfigs(updates, options): the persistence boundary.
//     The contract is the SHAPE of `updates` (which keys, with what values) and
//     the `removeIfUndefined` option:
//       * string fields normalize '' -> undefined and are removed from DB so the
//         effective value falls back to the env var (Req 4.4)
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
        { provider: 'openai', model: 'gpt-4o' },
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

  describe('successful save (Req 2.3, 2.4, 7.1)', () => {
    it('maps fields to config keys, clears the cache, and emits the audit action', async () => {
      const { res } = await invoke({
        aiEnabled: true,
        provider: 'openai',
        apiKey: 'sk-new-key',
        model: 'gpt-4o',
        providerOptions: '{"openai":{"temperature":0.2}}',
        azureOpenaiSettings: { useEntraId: true },
      });

      const [updates] = updateCall();
      expect(updates).toMatchObject({
        'app:aiEnabled': true,
        'ai:provider': 'openai',
        'ai:apiKey': 'sk-new-key',
        'ai:model': 'gpt-4o',
        'ai:providerOptions': '{"openai":{"temperature":0.2}}',
        // The azureOpenaiSettings object is re-assembled into the config value.
        'ai:azureOpenaiSettings': { useEntraId: true },
      });

      expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('update', ACTIVITY_ID, {
        action: SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE,
      });
      expect(res.apiv3).toHaveBeenCalledTimes(1);
    });
  });

  describe('apiKey preservation (Req 5.x)', () => {
    it('omits ai:apiKey from updates when apiKey is undefined (existing key preserved)', async () => {
      // Same provider as stored: the merge ("keep existing") applies.
      await invoke(
        { provider: 'openai', model: 'gpt-4o' },
        { currentProvider: 'openai' },
      );

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });

    it('omits ai:apiKey from updates when apiKey is an empty string (existing key preserved)', async () => {
      await invoke(
        { provider: 'openai', model: 'gpt-4o', apiKey: '' },
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
      await invoke(
        { provider: 'google', model: 'gemini-2.5-flash' },
        { currentProvider: 'openai' },
      );

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
          model: 'gemini-2.5-flash',
        },
        { currentProvider: 'openai' },
      );

      const [updates] = updateCall();
      expect(updates['ai:apiKey']).toBe('new-google-key');
    });

    it('preserves the stored key (omits ai:apiKey) when the provider is unchanged', async () => {
      await invoke(
        { provider: 'openai', model: 'gpt-4o' },
        { currentProvider: 'openai' },
      );

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });
  });

  // The handler receives ALREADY-sanitized input: the validator's customSanitizer
  // (middleware) has turned cleared strings into `undefined` before the handler
  // runs. These tests invoke the handler directly (bypassing the middleware), so
  // they feed `undefined` to represent a post-sanitizer cleared field. The
  // sanitizer's own '' -> undefined behavior is covered in the validators block.
  describe('cleared string fields with removeIfUndefined (Req 4.4)', () => {
    it('keeps cleared (undefined) string keys present so removeIfUndefined deletes them from the DB', async () => {
      await invoke({
        provider: 'openai',
        model: undefined,
        providerOptions: undefined,
        azureOpenaiSettings: {},
      });

      const [updates, options] = updateCall();
      expect(options).toMatchObject({ removeIfUndefined: true });
      expect(updates['ai:model']).toBeUndefined();
      expect(updates['ai:providerOptions']).toBeUndefined();
      // All Azure fields cleared (and useEntraId not provided) -> the object
      // collapses to undefined so removeIfUndefined deletes the consolidated key.
      expect(updates['ai:azureOpenaiSettings']).toBeUndefined();
      // Non-empty string keeps its value.
      expect(updates['ai:provider']).toBe('openai');
      // The keys are still present in the updates object so removeIfUndefined deletes them.
      expect(updates).toHaveProperty('ai:model');
      expect(updates).toHaveProperty('ai:azureOpenaiSettings');
    });

    it('keeps a non-empty string field value', async () => {
      await invoke({ provider: 'openai', model: 'gpt-4o' });

      const [updates] = updateCall();
      expect(updates['ai:model']).toBe('gpt-4o');
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

  // providerOptions uses the shared FE/BE predicate (isValidProviderOptionsJson),
  // which requires a provider-namespaced JSON object — the shape the runtime
  // applies — so client and server accept/reject exactly the same input and a
  // wrong-shape value is rejected here instead of saved-then-silently-ignored.
  describe('providerOptions (shared provider-namespaced predicate)', () => {
    it('accepts a provider-namespaced JSON object string', async () => {
      const { hasErrors } = await runValidators({
        providerOptions: '{"openai":{"temperature":0.7}}',
      });
      expect(hasErrors).toBe(false);
    });

    // Parsable JSON of the wrong shape (arrays, bare primitives, or an object
    // whose value is not itself an option object) is rejected up front — the
    // runtime would ignore it, so accepting it on save would be a silent no-op.
    it.each([
      '[1,2,3]',
      'true',
      'false',
      'null',
      '42',
      '"x"',
      '{"temperature":0.2}',
      '{"openai":[1,2]}',
    ])('rejects the wrong-shape JSON value "%s"', async (providerOptions) => {
      const { hasErrors, failedFields } = await runValidators({
        providerOptions,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providerOptions');
    });

    it('rejects a malformed JSON string', async () => {
      const { hasErrors, failedFields } = await runValidators({
        providerOptions: '{ invalid',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain('providerOptions');
    });

    it('accepts an empty string (cleared option, valid "no options")', async () => {
      const { hasErrors } = await runValidators({ providerOptions: '' });
      expect(hasErrors).toBe(false);
    });

    it('accepts a request that omits providerOptions', async () => {
      const { hasErrors } = await runValidators({});
      expect(hasErrors).toBe(false);
    });
  });

  // The string fields are type-guarded with .isString(): a non-string value is
  // rejected, a string passes. The Azure connection strings live under the nested
  // azureOpenaiSettings object (validated by dot-path).
  describe('string type validation (.isString())', () => {
    it.each([
      'apiKey',
      'model',
      'providerOptions',
    ])('rejects a non-string value for "%s"', async (field) => {
      const { hasErrors, failedFields } = await runValidators({
        [field]: 123,
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain(field);
    });

    it.each([
      'apiKey',
      'model',
    ])('accepts a string value for "%s"', async (field) => {
      const { hasErrors } = await runValidators({ [field]: 'some-value' });
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

  // The clearable string fields carry a customSanitizer that the production
  // middleware applies before the handler runs: '' -> undefined so that
  // removeIfUndefined deletes them and the value falls back to the env var
  // (Req 4.4). This is the only place that behavior is exercised — the handler
  // tests bypass the middleware, so they no longer see the normalization.
  describe('customSanitizer clears empty strings ("" -> undefined) (Req 4.4)', () => {
    it.each([
      'model',
      'providerOptions',
    ])('sanitizes an empty "%s" to undefined', async (field) => {
      const { hasErrors, body } = await runValidators({ [field]: '' });
      expect(hasErrors).toBe(false);
      expect(body[field]).toBeUndefined();
    });

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

    it('leaves a non-empty clearable string untouched', async () => {
      const { body } = await runValidators({ model: 'gpt-4o' });
      expect(body.model).toBe('gpt-4o');
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
      model: 'gpt-4o',
      providerOptions: '{"openai":{"temperature":0.2}}',
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
