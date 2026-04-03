import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useContentAutoScroll,
  watchRenderingAndReScroll,
} from './use-content-auto-scroll';

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
    await vi.advanceTimersByTimeAsync(0);

    // The timer should NOT have been reset — 2 more seconds should fire it
    vi.advanceTimersByTime(2000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should detect rendering elements added after initial check via observer', async () => {
    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    vi.advanceTimersByTime(3000);
    expect(scrollToTarget).not.toHaveBeenCalled();

    // Add a rendering element later (within 10s timeout)
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    // Flush microtasks so MutationObserver callback fires
    await vi.advanceTimersByTimeAsync(0);

    // Timer should be scheduled — fires after 5s
    await vi.advanceTimersByTimeAsync(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

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

  it('should not schedule further re-scrolls after rendering elements complete', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // First timer fires at 5s — re-scroll executes
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    // Rendering completes — attribute toggled to false
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    await vi.advanceTimersByTimeAsync(0);

    // No further re-scrolls should be scheduled
    vi.advanceTimersByTime(10000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should scroll exactly once when rendering completes before the first timer fires', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // Rendering completes before the first poll timer fires
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');

    // Poll timer fires at 5s — detects no rendering elements.
    // wasRendering is reset in the timer callback BEFORE scrollToTarget so that
    // the subsequent checkAndSchedule call does not trigger a redundant extra scroll.
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    // No further scrolls after rendering is confirmed done
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });
});

describe('useContentAutoScroll', () => {
  const containerId = 'test-content-container';
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('should not scroll when key is null', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() =>
      useContentAutoScroll({ key: null, contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should not scroll when key is undefined', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() =>
      useContentAutoScroll({ key: undefined, contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should not scroll when hash is empty', () => {
    window.location.hash = '';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should not scroll when container is not found', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() =>
      useContentAutoScroll({
        key: 'page-id',
        contentContainerId: 'nonexistent-id',
      }),
    );

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should scroll to target when it already exists in DOM', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should decode encoded hash values before target resolution', () => {
    // Japanese characters encoded
    window.location.hash = '#%E6%97%A5%E6%9C%AC%E8%AA%9E';
    const target = document.createElement('div');
    target.id = '日本語';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should use custom resolveTarget when provided', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.scrollIntoView = vi.fn();
    const resolveTarget = vi.fn(() => target);

    const { unmount } = renderHook(() =>
      useContentAutoScroll({
        key: 'page-id',
        contentContainerId: containerId,
        resolveTarget,
      }),
    );

    expect(resolveTarget).toHaveBeenCalledWith('heading');
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should use custom scrollTo when provided', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    container.appendChild(target);

    const customScrollTo = vi.fn();

    const { unmount } = renderHook(() =>
      useContentAutoScroll({
        key: 'page-id',
        contentContainerId: containerId,
        scrollTo: customScrollTo,
      }),
    );

    expect(customScrollTo).toHaveBeenCalledWith(target);

    unmount();
  });

  it('should start rendering watch after scrolling to target', () => {
    window.location.hash = '#heading';

    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Re-scroll after 5s due to rendering watch
    vi.advanceTimersByTime(5000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('should skip rendering watch when no rendering elements exist after initial scroll', () => {
    window.location.hash = '#heading';

    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // No re-scroll since no rendering elements
    vi.advanceTimersByTime(5000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should wait for target via MutationObserver when not yet in DOM', async () => {
    window.location.hash = '#deferred';

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    // Target appears after initial render
    const target = document.createElement('div');
    target.id = 'deferred';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    // Flush microtasks for MutationObserver
    await vi.advanceTimersByTimeAsync(0);

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should stop target observer after 10s timeout when target never appears', async () => {
    window.location.hash = '#never-appears';

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    // Advance past the timeout
    vi.advanceTimersByTime(11000);

    // Target appears after timeout — should NOT trigger scroll
    const target = document.createElement('div');
    target.id = 'never-appears';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    await vi.advanceTimersByTimeAsync(0);

    expect(target.scrollIntoView).not.toHaveBeenCalled();

    unmount();
  });

  it('should clean up all observers and timers on unmount', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const { unmount } = renderHook(() =>
      useContentAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();

    // No further scrolls after unmount
    vi.advanceTimersByTime(20000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('should re-run effect when key changes', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { rerender, unmount } = renderHook(
      ({ key }) =>
        useContentAutoScroll({ key, contentContainerId: containerId }),
      { initialProps: { key: 'page-1' as string | null } },
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Change key — effect re-runs
    rerender({ key: 'page-2' });
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    // Set to null — no additional scroll
    rerender({ key: null });
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
  });
});
