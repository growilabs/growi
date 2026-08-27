import type { RefObject } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useContainerSettle, WATCH_TIMEOUT_MS } from './use-container-settle';

describe('useContainerSettle', () => {
  let container: HTMLDivElement;
  let containerRef: RefObject<HTMLElement | null>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    containerRef = { current: container };
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not fire while a rendering element is present', () => {
    vi.useFakeTimers();

    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const onSettle = vi.fn();
    const { unmount } = renderHook(() =>
      useContainerSettle(containerRef, onSettle),
    );

    vi.advanceTimersByTime(5000);
    expect(onSettle).not.toHaveBeenCalled();

    unmount();
  });

  // Real timers: happy-dom's MutationObserver does not fire reliably when a
  // setTimeout is pending in the same scope under fake timers (see the same
  // note in use-hash-auto-scroll.spec.tsx); observeContainerSettle always
  // arms a WATCH_TIMEOUT_MS setTimeout, so fake timers are unusable here.
  it('fires exactly once when the rendering element is removed', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const onSettle = vi.fn();
    const { unmount } = renderHook(() =>
      useContainerSettle(containerRef, onSettle),
    );

    expect(onSettle).not.toHaveBeenCalled();

    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    await waitFor(() => expect(onSettle).toHaveBeenCalledTimes(1));

    // Further mutations while already settled must not refire.
    container.appendChild(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSettle).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('fires again after a later rendering cycle settles (self-healing)', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const onSettle = vi.fn();
    const { unmount } = renderHook(() =>
      useContainerSettle(containerRef, onSettle),
    );

    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    await waitFor(() => expect(onSettle).toHaveBeenCalledTimes(1));

    // A widget re-enters the rendering state (e.g. lsx refreshing content)...
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSettle).toHaveBeenCalledTimes(1);

    // ...and settles again — onSettle fires a second time.
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    await waitFor(() => expect(onSettle).toHaveBeenCalledTimes(2));

    unmount();
  });

  it('fires exactly once after the timeout, then stops observing entirely', async () => {
    vi.useFakeTimers();

    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const onSettle = vi.fn();
    const { unmount } = renderHook(() =>
      useContainerSettle(containerRef, onSettle),
    );

    vi.advanceTimersByTime(WATCH_TIMEOUT_MS - 1);
    expect(onSettle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSettle).toHaveBeenCalledTimes(1);

    // Prove observation actually stopped (not just "nothing changed"):
    // switch to real timers and mutate the DOM the same way the "removed"
    // test does. If the observer were still connected, this would reliably
    // reach onSettle again; per design.md, the timeout fallback disconnects
    // the observer before firing, so no further call must occur.
    vi.useRealTimers();
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onSettle).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('fires once immediately on mount when no rendering elements exist', () => {
    vi.useFakeTimers();

    const onSettle = vi.fn();
    const { unmount } = renderHook(() =>
      useContainerSettle(containerRef, onSettle),
    );

    expect(onSettle).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('stops observing on unmount', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const onSettle = vi.fn();
    const { unmount } = renderHook(() =>
      useContainerSettle(containerRef, onSettle),
    );

    unmount();

    // The observer is disconnected synchronously by unmount's cleanup, so
    // this mutation must not reach onSettle even with a short real wait.
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSettle).not.toHaveBeenCalled();

    // The watchdog timer was also cleared by cleanup, so advancing past
    // WATCH_TIMEOUT_MS must not trigger the fallback fire either.
    vi.useFakeTimers();
    vi.advanceTimersByTime(WATCH_TIMEOUT_MS + 1000);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
