// --- Mock boundary ---------------------------------------------------------
//
// The jobs module wires two triggers around refreshModelCatalog:
//   - isAiEnabled / readAiDisabledReason : mocked — the gate that fronts BOTH
//     triggers (a refresh runs when AI is enabled or the disabled reason is
//     catalog_stale)
//   - configManager      : mocked — drives the startup-refresh option
//   - node-cron          : mocked — asserts whether/what gets scheduled and
//     lets the test fire the tick callback deterministically
//   - refreshModelCatalog: mocked — the refresh behavior itself is covered by
//     refresh-model-catalog.spec.ts; here only the trigger contract matters
//   - Math.random + fake timers : pinned per test in the jitter block, so the
//     random wait of a periodic tick is deterministic
const { isAiEnabled } = vi.hoisted(() => ({ isAiEnabled: vi.fn() }));
vi.mock('./is-ai-enabled', () => ({ isAiEnabled }));

const { readAiDisabledReason } = vi.hoisted(() => ({
  readAiDisabledReason: vi.fn(),
}));
vi.mock('~/features/ai-usage/server', () => ({
  readAiDisabledReason,
  AI_DISABLED_REASON_CATALOG_STALE: 'catalog_stale',
}));

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

const { cronScheduleMock, scheduledTask } = vi.hoisted(() => ({
  cronScheduleMock: vi.fn(),
  scheduledTask: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock('node-cron', () => ({
  default: { schedule: cronScheduleMock },
}));

const { refreshModelCatalog } = vi.hoisted(() => ({
  refreshModelCatalog: vi.fn(),
}));
vi.mock('./ai-sdk-modules/refresh-model-catalog', () => ({
  refreshModelCatalog,
}));

import {
  startModelCatalogRefreshCronIfEnabled,
  triggerModelCatalogRefreshOnStartupIfEnabled,
} from './model-catalog-refresh-jobs';

const setConfig = (overrides: Record<string, unknown>): void => {
  getConfig.mockImplementation((key: string) => overrides[key]);
};

beforeEach(() => {
  vi.clearAllMocks();
  cronScheduleMock.mockReturnValue(scheduledTask);
  // AI enabled is the common case; the AI-off gate is asserted explicitly below.
  isAiEnabled.mockReturnValue(true);
  readAiDisabledReason.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const disableAi = (reason: string | undefined): void => {
  isAiEnabled.mockReturnValue(false);
  readAiDisabledReason.mockReturnValue(reason);
};

describe('startModelCatalogRefreshCronIfEnabled (Req 9.3, 9.6)', () => {
  it('does NOT schedule anything when AI is disabled with no disabled reason, even with a valid schedule (Req 6.2)', () => {
    disableAi(undefined);
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '0 4 * * *' });

    startModelCatalogRefreshCronIfEnabled();

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('does NOT schedule anything when AI is disabled for a reason other than catalog_stale (Req 6.2)', () => {
    disableAi('maintenance');
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '0 4 * * *' });

    startModelCatalogRefreshCronIfEnabled();

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('still schedules when AI is disabled with the catalog_stale reason (Req 6.1)', () => {
    disableAi('catalog_stale');
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '0 4 * * *' });

    startModelCatalogRefreshCronIfEnabled();

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduledTask.start).toHaveBeenCalledTimes(1);
  });

  it('does NOT schedule anything when the cron config is unset', () => {
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': undefined });

    startModelCatalogRefreshCronIfEnabled();

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('does NOT schedule anything when the cron config is blank', () => {
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '   ' });

    startModelCatalogRefreshCronIfEnabled();

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('schedules with the configured expression and starts the job (Req 9.3)', () => {
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '0 4 * * *' });

    startModelCatalogRefreshCronIfEnabled();

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(cronScheduleMock.mock.calls[0][0]).toBe('0 4 * * *');
    expect(scheduledTask.start).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the scheduled fetch fails (no unhandled rejection)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '0 4 * * *' });
    refreshModelCatalog.mockRejectedValue(new Error('offline'));

    startModelCatalogRefreshCronIfEnabled();
    const tick = cronScheduleMock.mock.calls[0][1] as () => Promise<void>;
    const ticking = tick();
    await vi.advanceTimersByTimeAsync(1);
    await ticking;

    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
  });

  it('does not throw when scheduling fails (e.g. invalid expression) — boot must survive (Req 9.4)', () => {
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': 'not a cron expr' });
    cronScheduleMock.mockImplementation(() => {
      throw new Error('invalid cron expression');
    });

    expect(() => startModelCatalogRefreshCronIfEnabled()).not.toThrow();
  });
});

describe('triggerModelCatalogRefreshOnStartupIfEnabled (Req 9.2, 9.6)', () => {
  it('does nothing when AI is disabled with no disabled reason, even with the startup option on (Req 6.2)', () => {
    disableAi(undefined);
    setConfig({ 'ai:modelCatalogRefreshOnStartup': true });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).not.toHaveBeenCalled();
  });

  it('does nothing when AI is disabled for a reason other than catalog_stale (Req 6.2)', () => {
    disableAi('maintenance');
    setConfig({ 'ai:modelCatalogRefreshOnStartup': true });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).not.toHaveBeenCalled();
  });

  it('fetches at startup when AI is disabled with the catalog_stale reason (Req 6.1, 6.7)', () => {
    disableAi('catalog_stale');
    setConfig({ 'ai:modelCatalogRefreshOnStartup': true });
    refreshModelCatalog.mockResolvedValue({
      counts: {},
      fetchedAt: new Date(),
    });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
  });

  it('does NOT fetch at startup with the startup option off even when the catalog_stale reason is set (Req 6.7)', () => {
    disableAi('catalog_stale');
    setConfig({ 'ai:modelCatalogRefreshOnStartup': false });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).not.toHaveBeenCalled();
  });

  it('does nothing when the startup option is off', () => {
    setConfig({ 'ai:modelCatalogRefreshOnStartup': false });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).not.toHaveBeenCalled();
  });

  it('fires the refresh when the startup option is on (Req 9.2)', () => {
    setConfig({ 'ai:modelCatalogRefreshOnStartup': true });
    refreshModelCatalog.mockResolvedValue({
      counts: {},
      fetchedAt: new Date(),
    });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
  });

  it('swallows a refresh failure (fire-and-forget; boot never fails) (Req 9.2, 9.4)', async () => {
    setConfig({ 'ai:modelCatalogRefreshOnStartup': true });
    let rejectRefresh: (err: Error) => void = () => {};
    refreshModelCatalog.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );

    expect(() => triggerModelCatalogRefreshOnStartupIfEnabled()).not.toThrow();

    // Reject AFTER the trigger returned — the .catch handler must absorb it
    // (an unhandled rejection would fail this test via vitest's process hooks).
    rejectRefresh(new Error('offline'));
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('periodic refresh jitter (Req 6.4, 6.5)', () => {
  const HALF_HOUR_MS = 30 * 60 * 1000;

  const startAndGetTick = (): (() => Promise<void>) => {
    setConfig({ 'ai:modelCatalogRefreshCronSchedule': '0 4 * * *' });
    refreshModelCatalog.mockResolvedValue({
      counts: {},
      fetchedAt: new Date(),
    });
    startModelCatalogRefreshCronIfEnabled();
    return cronScheduleMock.mock.calls[0][1] as () => Promise<void>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('waits the random delay before fetching on a cron tick (Req 6.4)', async () => {
    const tick = startAndGetTick();

    const ticking = tick();
    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS - 1);
    expect(refreshModelCatalog).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await ticking;
    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
  });

  it('fetches the previous tick immediately when the next tick arrives, and the new tick waits again (Req 6.5)', async () => {
    const tick = startAndGetTick();

    const first = tick();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(refreshModelCatalog).not.toHaveBeenCalled();

    const second = tick();
    await first;
    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HALF_HOUR_MS - 1);
    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(refreshModelCatalog).toHaveBeenCalledTimes(2);
  });

  it('does not wait for the startup refresh (Req 6.7)', () => {
    setConfig({ 'ai:modelCatalogRefreshOnStartup': true });
    refreshModelCatalog.mockResolvedValue({
      counts: {},
      fetchedAt: new Date(),
    });

    triggerModelCatalogRefreshOnStartupIfEnabled();

    expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
  });
});
