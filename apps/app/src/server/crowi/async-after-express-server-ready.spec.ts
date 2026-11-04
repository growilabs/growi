const { warnIfUsageBaseModelInvalid, triggerRefreshOnStartup } = vi.hoisted(
  () => ({
    warnIfUsageBaseModelInvalid: vi.fn<() => Promise<void>>(),
    triggerRefreshOnStartup: vi.fn<() => void>(),
  }),
);

vi.mock('~/features/ai-usage/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/features/ai-usage/server')>()),
  warnIfUsageBaseModelInvalid,
}));

vi.mock(
  '~/features/mastra/server/services/model-catalog-refresh-jobs',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('~/features/mastra/server/services/model-catalog-refresh-jobs')
    >()),
    triggerModelCatalogRefreshOnStartupIfEnabled: triggerRefreshOnStartup,
  }),
);

import Crowi from '.';

describe('Crowi.asyncAfterExpressServerReady', () => {
  beforeEach(() => {
    warnIfUsageBaseModelInvalid.mockReset();
    triggerRefreshOnStartup.mockReset();
  });

  it('validates the usage base model setting', async () => {
    warnIfUsageBaseModelInvalid.mockResolvedValue();

    await new Crowi().asyncAfterExpressServerReady();

    await vi.waitFor(() => {
      expect(warnIfUsageBaseModelInvalid).toHaveBeenCalledTimes(1);
    });
  });

  it('still triggers the startup catalog refresh when the validation fails', async () => {
    warnIfUsageBaseModelInvalid.mockRejectedValue(new Error('boom'));

    await expect(
      new Crowi().asyncAfterExpressServerReady(),
    ).resolves.toBeUndefined();

    expect(triggerRefreshOnStartup).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(warnIfUsageBaseModelInvalid).toHaveBeenCalledTimes(1);
    });
  });
});
