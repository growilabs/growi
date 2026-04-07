import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHashAutoScroll } from './use-hash-auto-scroll';

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

  it('should not scroll when key is null', () => {
    window.location.hash = '#heading';
    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    renderHook(() =>
      useHashAutoScroll({ key: null, contentContainerId: containerId }),
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
      useHashAutoScroll({ key: undefined, contentContainerId: containerId }),
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
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
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
      useHashAutoScroll({
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
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
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
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
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
      useHashAutoScroll({
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
      useHashAutoScroll({
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
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Re-scroll after 5s due to rendering watch
    vi.advanceTimersByTime(5000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
  });

  // Poll interval is 5s, so this test needs more than 5s — extend timeout to 10s.
  // happy-dom's MutationObserver does not fire reliably with fake timers when a
  // setTimeout is pending in the same scope. Use real timers for this test only.
  it('should re-scroll when rendering elements appear after initial scroll (late-mounting async renderers)', async () => {
    vi.useRealTimers();

    window.location.hash = '#heading';

    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    // No rendering elements at scroll time
    const { unmount } = renderHook(() =>
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // Async renderer mounts after the initial scroll (simulates Mermaid/PlantUML loading)
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    // Wait for MO to fire and the 5s poll timer to elapse
    await new Promise<void>((resolve) => setTimeout(resolve, 5100));
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
  }, 10000);

  it('should not re-scroll when no rendering elements exist after initial scroll', () => {
    window.location.hash = '#heading';

    const target = document.createElement('div');
    target.id = 'heading';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    const { unmount } = renderHook(() =>
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    // No re-scroll since no rendering elements are present
    vi.advanceTimersByTime(5000);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should wait for target via MutationObserver when not yet in DOM', async () => {
    // happy-dom's MutationObserver does not fire when a fake-timer setTimeout is
    // pending in the same effect. Use real timers for this test only.
    vi.useRealTimers();

    window.location.hash = '#deferred';

    const { unmount } = renderHook(() =>
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
    );

    const target = document.createElement('div');
    target.id = 'deferred';
    target.scrollIntoView = vi.fn();
    container.appendChild(target);

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should stop target observer after 10s timeout when target never appears', async () => {
    window.location.hash = '#never-appears';

    const { unmount } = renderHook(() =>
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
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
      useHashAutoScroll({ key: 'page-id', contentContainerId: containerId }),
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
      ({ key }) => useHashAutoScroll({ key, contentContainerId: containerId }),
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
