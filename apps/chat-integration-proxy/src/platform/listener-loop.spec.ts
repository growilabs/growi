import {
  LISTENER_WINDOW_MS,
  type ListenerLoopDeps,
  startListenerLoop,
} from './listener-loop.js';

/** The largest delay `setTimeout` honors; anything above fires after 1 ms. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

const WINDOW_MS = 1_000;

interface FakeWindow {
  readonly durationMs: number;
  readonly signal: AbortSignal;
  /** Ends the window the way the service would: after `elapsedMs`. */
  end(elapsedMs: number): void;
}

/**
 * A service whose listener windows the test ends by hand, with a clock that
 * only moves when a window ends or a backoff is slept through.
 */
const fakeService = () => {
  let clock = 0;
  const windows: FakeWindow[] = [];
  const sleeps: number[] = [];
  const reports: string[] = [];
  let refuseNextStart: Error | null = null;

  const deps: ListenerLoopDeps = {
    label: 'discord',
    windowMs: WINDOW_MS,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    report: (message) => {
      reports.push(message);
    },
    startWindow: (durationMs, signal) => {
      if (refuseNextStart != null) {
        const error = refuseNextStart;
        refuseNextStart = null;
        return Promise.reject(error);
      }
      const startedAt = clock;
      let resolveEnded: () => void = () => undefined;
      const ended = new Promise<void>((resolve) => {
        resolveEnded = resolve;
      });
      signal.addEventListener('abort', () => resolveEnded(), { once: true });
      windows.push({
        durationMs,
        signal,
        end: (elapsedMs) => {
          clock = startedAt + elapsedMs;
          resolveEnded();
        },
      });
      return Promise.resolve({ ended });
    },
  };

  return {
    deps,
    windows,
    sleeps,
    reports,
    refuseNext: (error: Error) => {
      refuseNextStart = error;
    },
  };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: drains chained microtasks
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

describe('startListenerLoop', () => {
  it('opens one listener window as soon as it starts', async () => {
    const service = fakeService();

    const running = await startListenerLoop(service.deps);

    expect(service.windows).toHaveLength(1);
    expect(service.windows[0]?.durationMs).toBe(WINDOW_MS);
    expect(service.windows[0]?.signal.aborted).toBe(false);
    await running.stop();
  });

  it('opens the next window at once when one runs its full length', async () => {
    const service = fakeService();
    const running = await startListenerLoop(service.deps);

    service.windows[0]?.end(WINDOW_MS);
    await settle();

    expect(service.windows).toHaveLength(2);
    expect(service.sleeps).toEqual([]);
    expect(service.reports).toEqual([]);
    await running.stop();
  });

  it('reports a window that ended early and backs off before the next, longer each time', async () => {
    const service = fakeService();
    const running = await startListenerLoop(service.deps);

    service.windows[0]?.end(10);
    await settle();
    service.windows[1]?.end(10);
    await settle();

    expect(service.windows).toHaveLength(3);
    expect(service.sleeps).toHaveLength(2);
    expect(service.sleeps[0]).toBeGreaterThan(0);
    expect(service.sleeps[1]).toBeGreaterThan(service.sleeps[0] ?? 0);
    expect(service.reports).toHaveLength(2);
    expect(service.reports[0]).toContain('discord');
    await running.stop();
  });

  it('forgets earlier failures once a window runs its full length', async () => {
    const service = fakeService();
    const running = await startListenerLoop(service.deps);

    service.windows[0]?.end(10);
    await settle();
    service.windows[1]?.end(WINDOW_MS);
    await settle();
    service.windows[2]?.end(10);
    await settle();

    expect(service.sleeps).toHaveLength(2);
    expect(service.sleeps[1]).toBe(service.sleeps[0]);
    await running.stop();
  });

  it('rejects when the very first window cannot be opened, so the caller can retry', async () => {
    const service = fakeService();
    service.refuseNext(new Error('chat not initialized'));

    await expect(startListenerLoop(service.deps)).rejects.toThrow(
      'chat not initialized',
    );
    expect(service.windows).toHaveLength(0);
  });

  it('keeps retrying with a report when a later window cannot be opened', async () => {
    const service = fakeService();
    const running = await startListenerLoop(service.deps);

    service.refuseNext(new Error('refused'));
    service.windows[0]?.end(WINDOW_MS);
    await settle();

    expect(service.reports).toHaveLength(1);
    expect(service.sleeps).toHaveLength(1);
    expect(service.windows).toHaveLength(2);
    await running.stop();
  });

  it('ends the open window on stop and opens no other afterwards', async () => {
    const service = fakeService();
    const running = await startListenerLoop(service.deps);

    await running.stop();
    await settle();

    expect(service.windows).toHaveLength(1);
    expect(service.windows[0]?.signal.aborted).toBe(true);
    expect(service.reports).toEqual([]);
  });

  describe('waiting for the open window on stop', () => {
    const STOP_WAIT_MS = 50;

    /** A window that keeps running after abort until the service lets go. */
    const slowToClose = (service: ReturnType<typeof fakeService>) => {
      let release: () => void = () => undefined;
      const deps: ListenerLoopDeps = {
        ...service.deps,
        stopWaitMs: STOP_WAIT_MS,
        startWindow: () =>
          Promise.resolve({
            ended: new Promise<void>((resolve) => {
              release = resolve;
            }),
          }),
      };
      return { deps, release: () => release() };
    };

    it('resolves once the window has ended, when that comes first', async () => {
      const service = fakeService();
      const window = slowToClose(service);
      const running = await startListenerLoop(window.deps);

      let stopped = false;
      const stopping = running.stop().then(() => {
        stopped = true;
      });
      await settle();
      expect(stopped).toBe(false);

      window.release();
      await stopping;
      expect(service.reports).toEqual([]);
    });

    it('gives up waiting after the bound and says so, so other connections are not held up', async () => {
      const service = fakeService();
      const window = slowToClose(service);
      const running = await startListenerLoop(window.deps);

      const startedAt = Date.now();
      await running.stop();

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(STOP_WAIT_MS - 5);
      expect(service.reports).toHaveLength(1);
      expect(service.reports[0]).toContain('discord');
      window.release();
    });

    it('also waits for a window that was being opened when the stop came in', async () => {
      const service = fakeService();
      let call = 0;
      let finishOpening: () => void = () => undefined;
      let release: () => void = () => undefined;
      let secondEnded = false;
      const running = await startListenerLoop({
        ...service.deps,
        stopWaitMs: 1_000,
        startWindow: (durationMs, signal) => {
          call += 1;
          if (call === 1) return service.deps.startWindow(durationMs, signal);
          return new Promise((resolve) => {
            finishOpening = () =>
              resolve({
                ended: new Promise<void>((done) => {
                  release = () => {
                    secondEnded = true;
                    done();
                  };
                }),
              });
          });
        },
      });

      service.windows[0]?.end(WINDOW_MS);
      await settle();
      let stopped = false;
      const stopping = running.stop().then(() => {
        stopped = true;
      });
      finishOpening();
      await settle();
      expect(stopped).toBe(false);

      release();
      await stopping;
      expect(secondEnded).toBe(true);
      expect(service.reports).toEqual([]);
    });
  });

  it('stops promptly while backing off', async () => {
    const service = fakeService();
    let wake: () => void = () => undefined;
    const running = await startListenerLoop({
      ...service.deps,
      sleep: (_ms, signal) =>
        new Promise<void>((resolve) => {
          wake = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    });

    service.windows[0]?.end(10);
    await settle();
    await running.stop();
    wake();
    await settle();

    expect(service.windows).toHaveLength(1);
  });

  it('treats a window whose end rejects as an early end rather than crashing', async () => {
    const service = fakeService();
    let call = 0;
    const running = await startListenerLoop({
      ...service.deps,
      startWindow: (durationMs, signal) => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({ ended: Promise.reject(new Error('boom')) });
        }
        return service.deps.startWindow(durationMs, signal);
      },
    });
    await settle();

    expect(service.reports).toHaveLength(1);
    expect(service.windows).toHaveLength(1);
    await running.stop();
  });
});

describe('startListenerLoop signals', () => {
  it('hands each window its own signal, so a later stop never reaches a finished window', async () => {
    const service = fakeService();
    const running = await startListenerLoop(service.deps);

    service.windows[0]?.end(WINDOW_MS);
    await settle();
    await running.stop();

    expect(service.windows).toHaveLength(2);
    expect(service.windows[0]?.signal).not.toBe(service.windows[1]?.signal);
    expect(service.windows[0]?.signal.aborted).toBe(false);
    expect(service.windows[1]?.signal.aborted).toBe(true);
  });

  it('stops at once during a backoff wait with the default sleep', async () => {
    const service = fakeService();
    const { sleep: _injected, ...withDefaultSleep } = service.deps;
    const running = await startListenerLoop({
      ...withDefaultSleep,
      stopWaitMs: 60_000,
    });
    service.windows[0]?.end(10);
    await settle();
    expect(service.reports).toHaveLength(1);

    const startedAt = Date.now();
    await running.stop();

    // The first backoff is seconds long; returning well before it proves the
    // wait was cut short rather than sat out.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(service.windows).toHaveLength(1);
  });
});

describe('LISTENER_WINDOW_MS', () => {
  it('fits in a timer, which would otherwise end every window after 1 ms', () => {
    expect(LISTENER_WINDOW_MS).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
    expect(LISTENER_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
