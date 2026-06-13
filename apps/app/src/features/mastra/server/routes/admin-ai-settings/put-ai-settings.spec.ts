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
//       * boolean fields (app:aiEnabled, ai:azureOpenaiUseEntraId) are always saved
//       * ai:apiKey is the exception: present only when a non-empty value is sent,
//         omitted otherwise so the stored key is preserved (never cleared) (Req 5.x)
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
  { useOnlyEnvVars = false }: { useOnlyEnvVars?: boolean } = {},
) => {
  getConfig.mockImplementation((key: string) =>
    key === 'env:useOnlyEnvVars:ai' ? useOnlyEnvVars : undefined,
  );

  const req = mock<CrowiRequest>();
  // express-validator + apiV3FormValidator run as middleware before this handler,
  // so the handler trusts req.body as the validated request.
  (req as unknown as { body: AiSettingsUpdateRequest }).body = body;

  const res = mock<ApiV3Response>();
  res.locals = { activity: { _id: ACTIVITY_ID } } as ApiV3Response['locals'];

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

      const apiv3Err = res.apiv3Err as unknown as ReturnType<typeof vi.fn>;
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
        providerOptions: '{"temperature":0.2}',
        azureOpenaiUseEntraId: true,
      });

      const [updates] = updateCall();
      expect(updates).toMatchObject({
        'app:aiEnabled': true,
        'ai:provider': 'openai',
        'ai:apiKey': 'sk-new-key',
        'ai:model': 'gpt-4o',
        'ai:providerOptions': '{"temperature":0.2}',
        'ai:azureOpenaiUseEntraId': true,
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
      await invoke({ provider: 'openai', model: 'gpt-4o' });

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });

    it('omits ai:apiKey from updates when apiKey is an empty string (existing key preserved)', async () => {
      await invoke({ provider: 'openai', model: 'gpt-4o', apiKey: '' });

      const [updates] = updateCall();
      expect(updates).not.toHaveProperty('ai:apiKey');
    });

    it('includes ai:apiKey only when a non-empty value is provided', async () => {
      await invoke({ apiKey: 'sk-set-me' });

      const [updates] = updateCall();
      expect(updates['ai:apiKey']).toBe('sk-set-me');
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
        azureOpenaiResourceName: undefined,
        azureOpenaiBaseUrl: undefined,
        azureOpenaiApiVersion: undefined,
      });

      const [updates, options] = updateCall();
      expect(options).toMatchObject({ removeIfUndefined: true });
      expect(updates['ai:model']).toBeUndefined();
      expect(updates['ai:providerOptions']).toBeUndefined();
      expect(updates['ai:azureOpenaiResourceName']).toBeUndefined();
      expect(updates['ai:azureOpenaiBaseUrl']).toBeUndefined();
      expect(updates['ai:azureOpenaiApiVersion']).toBeUndefined();
      // Non-empty string keeps its value.
      expect(updates['ai:provider']).toBe('openai');
      // The keys are still present in the updates object so removeIfUndefined deletes them.
      expect(updates).toHaveProperty('ai:model');
      expect(updates).toHaveProperty('ai:azureOpenaiResourceName');
    });

    it('keeps a non-empty string field value', async () => {
      await invoke({ provider: 'openai', model: 'gpt-4o' });

      const [updates] = updateCall();
      expect(updates['ai:model']).toBe('gpt-4o');
    });

    it('always includes boolean fields even when false', async () => {
      await invoke({ aiEnabled: false, azureOpenaiUseEntraId: false });

      const [updates] = updateCall();
      expect(updates['app:aiEnabled']).toBe(false);
      expect(updates['ai:azureOpenaiUseEntraId']).toBe(false);
    });
  });

  describe('error handling (Req 5.3)', () => {
    it('answers apiv3Err and does not leak the apiKey when persistence fails', async () => {
      updateConfigs.mockRejectedValue(new Error('db write failed'));

      const { res } = await invoke({ apiKey: 'sk-leak-me-not' });

      const apiv3Err = res.apiv3Err as unknown as ReturnType<typeof vi.fn>;
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

  // providerOptions now uses the shared FE/BE predicate (isValidProviderOptionsJson,
  // JSON.parse based), so client and server accept/reject exactly the same input.
  describe('providerOptions (shared JSON.parse predicate)', () => {
    it('accepts a parsable JSON object string', async () => {
      const { hasErrors } = await runValidators({
        providerOptions: '{"openai":{"temperature":0.7}}',
      });
      expect(hasErrors).toBe(false);
    });

    // JSON.parse accepts objects, arrays, the literal primitives true/false/null,
    // AND bare numbers / quoted strings, so the shared predicate accepts them all.
    // This is the parity point with the client form.
    it.each([
      '[1,2,3]',
      'true',
      'false',
      'null',
      '42',
      '"x"',
    ])('accepts the parsable JSON value "%s"', async (providerOptions) => {
      const { hasErrors } = await runValidators({ providerOptions });
      expect(hasErrors).toBe(false);
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
  // rejected, a string passes. (apiKey and providerOptions share this guard.)
  describe('string type validation (.isString())', () => {
    it.each([
      'apiKey',
      'model',
      'providerOptions',
      'azureOpenaiResourceName',
      'azureOpenaiBaseUrl',
      'azureOpenaiApiVersion',
    ])('rejects a non-string value for "%s"', async (field) => {
      const { hasErrors, failedFields } = await runValidators({ [field]: 123 });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain(field);
    });

    it.each([
      'apiKey',
      'model',
      'azureOpenaiResourceName',
      'azureOpenaiBaseUrl',
      'azureOpenaiApiVersion',
    ])('accepts a string value for "%s"', async (field) => {
      const { hasErrors } = await runValidators({ [field]: 'some-value' });
      expect(hasErrors).toBe(false);
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
      'azureOpenaiResourceName',
      'azureOpenaiBaseUrl',
      'azureOpenaiApiVersion',
    ])('sanitizes an empty "%s" to undefined', async (field) => {
      const { hasErrors, body } = await runValidators({ [field]: '' });
      expect(hasErrors).toBe(false);
      expect(body[field]).toBeUndefined();
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
    it.each([
      'aiEnabled',
      'azureOpenaiUseEntraId',
    ])('accepts a boolean value for "%s"', async (field) => {
      const accepted = await runValidators({ [field]: true });
      expect(accepted.hasErrors).toBe(false);

      const acceptedFalse = await runValidators({ [field]: false });
      expect(acceptedFalse.hasErrors).toBe(false);
    });

    it.each([
      'aiEnabled',
      'azureOpenaiUseEntraId',
    ])('rejects a non-boolean value for "%s"', async (field) => {
      const { hasErrors, failedFields } = await runValidators({
        [field]: 'yes',
      });
      expect(hasErrors).toBe(true);
      expect(failedFields).toContain(field);
    });
  });

  it('accepts a fully populated valid request', async () => {
    const { hasErrors } = await runValidators({
      aiEnabled: true,
      provider: 'azure-openai',
      apiKey: 'secret-key',
      model: 'gpt-4o',
      providerOptions: '{"temperature":0.2}',
      azureOpenaiResourceName: 'my-resource',
      azureOpenaiBaseUrl: 'https://example.openai.azure.com',
      azureOpenaiApiVersion: '2024-02-01',
      azureOpenaiUseEntraId: false,
    });
    expect(hasErrors).toBe(false);
  });
});
