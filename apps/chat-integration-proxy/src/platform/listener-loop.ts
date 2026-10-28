// Keeps a service's listener running for as long as its connection is held,
// for a service whose SDK listens only for a bounded window per call (Discord's
// `startGatewayListener`). The window length and why an early end is the only
// failure signal are in research.md (「Discord の Gateway の生涯」).
//
// Nothing here imports the Chat SDK: opening one window is injected, so the
// loop is exercised without a socket.

/**
 * How long one window lasts. Longer means fewer restarts (each loses the
 * events sent while logging in again); it must stay at most 2^31-1 ms, past
 * which a timer fires after 1 ms and every window would end at once.
 */
export const LISTENER_WINDOW_MS = 24 * 60 * 60 * 1000;

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * The longest `stop()` waits for the open window to end. The SDK notices an
 * abort only once a login in progress settles, and `stop()` runs inside the
 * connection manager's cycle, where an unbounded wait would hold every other
 * lock's renewal past its expiry. A short overlap with the next owner is
 * already absorbed by event de-duplication (design.md 「(c) で閉じ終わるまで」).
 */
export const STOP_WAIT_MS = 5_000;

export interface ListenerWindow {
  /** Settles when the window is over, however it ended. */
  readonly ended: Promise<void>;
}

export interface ListenerLoopDeps {
  /** Names the service in reports. */
  readonly label: string;
  /** Rejects when the window could not be opened at all. */
  readonly startWindow: (
    durationMs: number,
    signal: AbortSignal,
  ) => Promise<ListenerWindow>;
  readonly report: (message: string, error?: unknown) => void;
  readonly windowMs?: number;
  readonly now?: () => number;
  /** Must settle early when `signal` aborts, so a stop is never held up. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly stopWaitMs?: number;
}

export interface RunningListener {
  /**
   * Ends the open window and resolves once it has ended, or after
   * `stopWaitMs` at the latest.
   */
  stop(): Promise<void>;
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const handle = setTimeout(done, ms);
    handle.unref?.();
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(handle);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });

const backoffFor = (failures: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);

/**
 * Opens the first window before resolving, so a caller that cannot open it
 * (`ConnectionManager.open`) learns so and backs off itself. Every later
 * failure is reported and retried here, because nobody is waiting on it.
 */
export const startListenerLoop = async (
  deps: ListenerLoopDeps,
): Promise<RunningListener> => {
  const windowMs = deps.windowMs ?? LISTENER_WINDOW_MS;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? abortableSleep;
  const stopWaitMs = deps.stopWaitMs ?? STOP_WAIT_MS;
  /** Ends the loop itself: no more windows, no more backoff. */
  const stopping = new AbortController();
  const { signal } = stopping;
  /**
   * One controller per window, never shared: the SDK leaves its abort
   * listener on the signal after a window ends by timeout, and that listener
   * keeps the window's destroyed client reachable for as long as the signal
   * lives.
   */
  let windowAbort: AbortController | null = null;

  const open = async (): Promise<{ window: ListenerWindow; at: number }> => {
    const at = now();
    windowAbort = new AbortController();
    const window = await deps.startWindow(windowMs, windowAbort.signal);
    return { window, at };
  };

  let current: { window: ListenerWindow; at: number } | null = await open();

  /** Settles to why the window ended early, or `null` when it ran its length. */
  const earlyEnd = async (opened: {
    window: ListenerWindow;
    at: number;
  }): Promise<{ detail: string; cause?: unknown } | null> => {
    let cause: unknown;
    try {
      await opened.window.ended;
    } catch (error) {
      cause = error;
    }
    const elapsed = now() - opened.at;
    if (cause == null && elapsed >= windowMs) return null;
    return {
      detail: `ended after ${elapsed}ms of its ${windowMs}ms window; the adapter log says why`,
      cause,
    };
  };

  const run = async (): Promise<void> => {
    try {
      await keepListening();
    } finally {
      // A window opened just as the stop came in is still logging in.
      await current?.window.ended.catch(() => undefined);
    }
  };

  const keepListening = async (): Promise<void> => {
    let failures = 0;
    const backOff = async (detail: string, cause?: unknown): Promise<void> => {
      failures += 1;
      const delay = backoffFor(failures);
      deps.report(
        `the ${deps.label} listener ${detail}. Retrying in ${delay}ms`,
        cause,
      );
      await sleep(delay, signal);
    };

    while (!signal.aborted) {
      if (current != null) {
        // biome-ignore lint/performance/noAwaitInLoops: one window at a time
        const early = await earlyEnd(current);
        current = null;
        if (signal.aborted) return;
        if (early == null) {
          failures = 0;
        } else {
          await backOff(early.detail, early.cause);
          if (signal.aborted) return;
        }
      }

      try {
        current = await open();
      } catch (error) {
        if (signal.aborted) return;
        await backOff('could not be started again', error);
      }
    }
  };

  const loop = run().catch((error: unknown) => {
    deps.report(`the ${deps.label} listener loop stopped unexpectedly`, error);
  });

  return {
    async stop() {
      stopping.abort();
      windowAbort?.abort();
      let handle: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        loop.then(() => false),
        new Promise<boolean>((resolve) => {
          handle = setTimeout(() => resolve(true), stopWaitMs);
          handle.unref?.();
        }),
      ]);
      clearTimeout(handle);
      if (timedOut) {
        deps.report(
          `the ${deps.label} listener had not closed ${stopWaitMs}ms after being stopped; moving on without it`,
        );
      }
    },
  };
};
