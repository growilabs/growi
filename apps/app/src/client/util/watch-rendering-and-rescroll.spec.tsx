import { setImmediate as realSetImmediate } from 'node:timers/promises';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchRenderingAndReScroll } from './watch-rendering-and-rescroll';

// happy-dom captures the real setTimeout at module load, before vitest's
// fake timers are installed. Its MutationObserver callbacks therefore fire
// on the REAL event loop, not on the fake timer clock. Yielding to the real
// event loop (via node:timers/promises) flushes them.
// Yield twice because happy-dom batches zero-delay timeouts and dispatch
// across two real-timer ticks (the batcher + the listener's own timer).
// NOTE: happy-dom v15 stores the MO listener callback in a `WeakRef`
// (see MutationObserverListener.cjs), so GC between `observe()` and the
// first mutation can silently drop delivery. Tests that assert MO-driven
// behavior should rely on retry to absorb that rare collection window.
const flushMutationObservers = async () => {
  await realSetImmediate();
  await realSetImmediate();
};

describe('watchRenderingAndReScroll', () => {
  let container: HTMLDivElement;
  let scrollToTarget: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    scrollToTarget = vi.fn(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('should not schedule a timer when no rendering elements exist', () => {
    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).not.toHaveBeenCalled();

    cleanup();
  });

  it('should schedule a scroll after 5s when rendering elements exist', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    expect(scrollToTarget).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should not reset timer on intermediate DOM mutations', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    vi.advanceTimersByTime(3000);
    expect(scrollToTarget).not.toHaveBeenCalled();

    // Trigger a DOM mutation mid-timer
    const child = document.createElement('span');
    container.appendChild(child);
    await flushMutationObservers();

    // The timer should NOT have been reset — 2 more seconds should fire it
    vi.advanceTimersByTime(2000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  // Retry absorbs rare happy-dom MO WeakRef GC drops (see file-top note).
  it(
    'should detect rendering elements added after initial check via observer',
    { retry: 3 },
    async () => {
      const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

      vi.advanceTimersByTime(3000);
      expect(scrollToTarget).not.toHaveBeenCalled();

      // Add a rendering element later (within 10s timeout)
      const renderingEl = document.createElement('div');
      renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
      container.appendChild(renderingEl);

      // Flush MO so it schedules the poll timer
      await flushMutationObservers();

      await vi.advanceTimersByTimeAsync(5000);
      expect(scrollToTarget).toHaveBeenCalledTimes(1);

      cleanup();
    },
  );

  it('should scroll once when multiple rendering elements exist simultaneously', () => {
    const renderingEl1 = document.createElement('div');
    renderingEl1.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl1);

    const renderingEl2 = document.createElement('div');
    renderingEl2.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl2);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should stop watching after 10s timeout', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // First scroll at 5s
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    // At 10s both the scroll timer and the watch timeout fire.
    vi.advanceTimersByTime(5000);
    const callsAfter10s = scrollToTarget.mock.calls.length;

    // After 10s, no further scrolls should occur regardless
    vi.advanceTimersByTime(10000);
    expect(scrollToTarget).toHaveBeenCalledTimes(callsAfter10s);

    cleanup();
  });

  it('should clean up timer and observer on cleanup call', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    cleanup();

    vi.advanceTimersByTime(10000);
    expect(scrollToTarget).not.toHaveBeenCalled();
  });

  it('should prevent timer callbacks from executing after cleanup (stopped flag)', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // Advance partway, then cleanup
    vi.advanceTimersByTime(3000);
    cleanup();

    // Timer would have fired at 5s, but cleanup was called
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).not.toHaveBeenCalled();
  });

  // Retry absorbs rare happy-dom MO WeakRef GC drops (see file-top note).
  it(
    'should perform a final re-scroll when rendering completes after the first poll',
    { retry: 3 },
    async () => {
      const renderingEl = document.createElement('div');
      renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
      container.appendChild(renderingEl);

      const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

      // First timer fires at 5s — re-scroll executes
      vi.advanceTimersByTime(5000);
      expect(scrollToTarget).toHaveBeenCalledTimes(1);

      // Rendering completes — attribute toggled to false. MO observes the
      // transition and triggers a final re-scroll to compensate for the
      // trailing layout shift.
      renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
      await flushMutationObservers();
      expect(scrollToTarget).toHaveBeenCalledTimes(2);

      // No further scrolls afterward — the MO cleared the next poll timer.
      vi.advanceTimersByTime(10000);
      expect(scrollToTarget).toHaveBeenCalledTimes(2);

      cleanup();
    },
  );

  it('should scroll exactly once when rendering completes before the first timer fires', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // Rendering completes before the first poll timer fires (no async flush,
    // so the MO does not deliver before the timer).
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');

    // wasRendering is reset in the timer callback BEFORE scrollToTarget so
    // the subsequent checkAndSchedule call does not trigger a redundant
    // extra scroll.
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    // No further scrolls after rendering is confirmed done
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
