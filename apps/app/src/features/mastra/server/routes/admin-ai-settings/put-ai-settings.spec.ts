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

import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { AiSettingsUpdateRequest } from '../../../interfaces/ai-settings';
import { putAiSettingsFactory } from './put-ai-settings';

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

  const handler = putAiSettingsFactory(buildCrowi());
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

  describe('string field normalization with removeIfUndefined (Req 4.4)', () => {
    it('normalizes empty string fields to undefined and removes them from the DB', async () => {
      await invoke({
        provider: 'openai',
        model: '',
        providerOptions: '',
        azureOpenaiResourceName: '',
        azureOpenaiBaseUrl: '',
        azureOpenaiApiVersion: '',
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
