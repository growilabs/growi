import { GROWI_RENDERING_ATTR } from '@growi/core/dist/consts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useHashAutoScroll,
  watchRenderingAndReScroll,
} from './use-hash-auto-scroll';

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
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    expect(scrollToTarget).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should not reset timer on intermediate DOM mutations', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // Advance 3 seconds
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
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    // Flush microtasks so MutationObserver callback fires
    await vi.advanceTimersByTimeAsync(0);

    // Timer should be scheduled — fires after 5s
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should clean up timer and observer on cleanup call', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    cleanup();

    vi.advanceTimersByTime(10000);
    expect(scrollToTarget).not.toHaveBeenCalled();
  });

  it('should scroll once when multiple rendering elements exist simultaneously', () => {
    // Two rendering elements present from the start (e.g. two DrawIO diagrams)
    const renderingEl1 = document.createElement('div');
    renderingEl1.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl1);

    const renderingEl2 = document.createElement('div');
    renderingEl2.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl2);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // Scroll fires once at 5s — not multiplied by element count
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('should stop watching after 10s timeout', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const cleanup = watchRenderingAndReScroll(container, scrollToTarget);

    // First scroll at 5s
    vi.advanceTimersByTime(5000);
    expect(scrollToTarget).toHaveBeenCalledTimes(1);

    // At 10s both the scroll timer and the watch timeout fire.
    // The scroll may or may not execute depending on timer ordering.
    vi.advanceTimersByTime(5000);
    const callsAfter10s = scrollToTarget.mock.calls.length;

    // After 10s, no further scrolls should occur regardless
    vi.advanceTimersByTime(10000);
    expect(scrollToTarget).toHaveBeenCalledTimes(callsAfter10s);

    cleanup();
  });
});

describe('useHashAutoScroll', () => {
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

  it('should not scroll when pageId is null', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() => useHashAutoScroll(null, containerId));

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should not scroll when hash is empty', () => {
    window.location.hash = '';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() => useHashAutoScroll('page-id', containerId));

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should not scroll when container is not found', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() => useHashAutoScroll('page-id', 'nonexistent-id'));

    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('should scroll to target when it already exists in DOM', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { unmount } = renderHook(() =>
      useHashAutoScroll('page-id', containerId),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should start rendering watch after scrolling to target', () => {
    window.location.hash = '#heading';

    // Target with a rendering element
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const { unmount } = renderHook(() =>
      useHashAutoScroll('page-id', containerId),
    );

    // Initial scroll
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Re-scroll after 5s due to rendering watch
    vi.advanceTimersByTime(5000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('should stop target observer after 10s timeout', async () => {
    window.location.hash = '#never-appears';

    const { unmount } = renderHook(() =>
      useHashAutoScroll('page-id', containerId),
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
    renderingEl.setAttribute(GROWI_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const { unmount } = renderHook(() =>
      useHashAutoScroll('page-id', containerId),
    );

    // Initial scroll
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Unmount before poll timer fires
    unmount();

    // No further scrolls after unmount
    vi.advanceTimersByTime(20000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('should re-run effect when pageId changes', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { rerender, unmount } = renderHook(
      ({ pageId }) => useHashAutoScroll(pageId, containerId),
      { initialProps: { pageId: 'page-1' as string | null } },
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Change pageId — effect re-runs
    rerender({ pageId: 'page-2' });
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    // Set to null — no additional scroll
    rerender({ pageId: null });
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
  });
});
