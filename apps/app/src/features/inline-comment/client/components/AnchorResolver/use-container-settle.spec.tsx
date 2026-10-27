import type { RefObject } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasRenderingElements,
  useContainerSettle,
  WATCH_TIMEOUT_MS,
} from './use-container-settle';

describe('hasRenderingElements', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns true when a descendant carries the rendering attribute', () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    expect(hasRenderingElements(container)).toBe(true);
  });

  it('returns false when no descendant carries the rendering attribute', () => {
    container.appendChild(document.createElement('span'));

    expect(hasRenderingElements(container)).toBe(false);
  });
});

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

// The firing condition is "no rendering element is present". It is evaluated
// synchronously once on mount, and again on every observed DOM change —
// those later checks being coalesced per animation frame. Driving the frames
// by hand (the same technique use-highlight-hit-test.spec.ts uses) makes both
// halves of that contract observable without racing a real frame.
describe('useContainerSettle — settle firing condition', () => {
  let container: HTMLDivElement;
  let containerRef: RefObject<HTMLElement | null>;

  let queuedFrames: FrameRequestCallback[] = [];
  let originalRaf: typeof window.requestAnimationFrame;
  let originalCancelRaf: typeof window.cancelAnimationFrame;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    containerRef = { current: container };

    queuedFrames = [];
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    document.body.innerHTML = '';
  });

  const runQueuedFrames = (): void => {
    const frames = queuedFrames;
    queuedFrames = [];
    act(() => {
      for (const frame of frames) {
        frame(performance.now());
      }
    });
  };

  // happy-dom delivers MutationObserver records asynchronously; a short real
  // wait lets the observer callback run before frames are driven by hand.
  const flushMutations = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 20));

  /**
   * Mounts the hook. The mount-time settle check fires synchronously, so it
   * has already happened (or been skipped) by the time this returns.
   */
  const mountSettled = (onSettle: () => void) =>
    renderHook(() => useContainerSettle(containerRef, onSettle));

  it('fires when an element carrying no rendering marker appears or disappears', async () => {
    const onSettle = vi.fn();
    const { unmount } = mountSettled(onSettle);
    expect(onSettle).toHaveBeenCalledTimes(1);
    onSettle.mockClear();

    // A heading's edit button showing up once collaborative-editing state
    // loads: no rendering marker anywhere, but the container's text changed.
    const editButton = document.createElement('span');
    editButton.textContent = 'edit_square';
    container.appendChild(editButton);
    await flushMutations();
    runQueuedFrames();
    expect(onSettle).toHaveBeenCalledTimes(1);

    // ...and disappearing again must give the caller another chance too.
    editButton.remove();
    await flushMutations();
    runQueuedFrames();
    expect(onSettle).toHaveBeenCalledTimes(2);

    unmount();
  });

  // A same-length in-place text correction (e.g. fixing a typo) makes React
  // update an existing Text node's `data` in place rather than adding/
  // removing any element -- a MutationRecord of type "characterData", not
  // "childList". Editing near a saved inline-comment anchor and returning to
  // View without a full page reload relies on exactly this firing so
  // useAnchorResolver re-resolves against the new text.
  it("fires when an existing text node's data changes in place, with no element added or removed", async () => {
    const paragraph = document.createElement('p');
    const textNode = document.createTextNode('the original text');
    paragraph.appendChild(textNode);
    container.appendChild(paragraph);

    const onSettle = vi.fn();
    const { unmount } = mountSettled(onSettle);
    expect(onSettle).toHaveBeenCalledTimes(1);
    onSettle.mockClear();

    // Same length, same node, same parent -- no childList/attribute mutation
    // occurs, only characterData.
    textNode.data = 'the corrected text';
    await flushMutations();
    runQueuedFrames();
    expect(onSettle).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('coalesces several changes within one frame into a single call', async () => {
    const onSettle = vi.fn();
    const { unmount } = mountSettled(onSettle);
    expect(onSettle).toHaveBeenCalledTimes(1);
    onSettle.mockClear();

    // Two separately observed batches (each flush lets the observer run),
    // both before any frame is driven.
    container.appendChild(document.createElement('span'));
    await flushMutations();
    container.appendChild(document.createElement('span'));
    await flushMutations();

    runQueuedFrames();
    expect(onSettle).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not fire while a rendering element is still present', async () => {
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    const onSettle = vi.fn();
    const { unmount } = mountSettled(onSettle);
    expect(onSettle).not.toHaveBeenCalled();

    container.appendChild(document.createElement('span'));
    await flushMutations();
    runQueuedFrames();
    expect(onSettle).not.toHaveBeenCalled();

    unmount();
  });

  it('does not fire when a rendering element appears before the pending frame runs', async () => {
    const onSettle = vi.fn();
    const { unmount } = mountSettled(onSettle);
    expect(onSettle).toHaveBeenCalledTimes(1);
    onSettle.mockClear();

    // An observed change queues a frame...
    container.appendChild(document.createElement('span'));
    await flushMutations();

    // ...but between scheduling and the frame, another widget starts
    // rendering (e.g. PlantUML right after Mermaid finished) — the container
    // is no longer settled, so the queued frame must not announce completion.
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);

    runQueuedFrames();
    expect(onSettle).not.toHaveBeenCalled();

    unmount();
  });

  it('does not fire a frame that was already pending at unmount', async () => {
    const onSettle = vi.fn();
    const { unmount } = mountSettled(onSettle);
    expect(onSettle).toHaveBeenCalledTimes(1);
    onSettle.mockClear();

    container.appendChild(document.createElement('span'));
    await flushMutations();

    unmount();

    runQueuedFrames();
    expect(onSettle).not.toHaveBeenCalled();
  });
});
