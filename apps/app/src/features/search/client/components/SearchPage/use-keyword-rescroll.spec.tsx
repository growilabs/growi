import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock watchRenderingAndReScroll
vi.mock('~/client/util/watch-rendering-and-rescroll', () => ({
  watchRenderingAndReScroll: vi.fn(() => vi.fn()), // returns a cleanup fn
}));

// Mock scrollWithinContainer
vi.mock('~/client/util/smooth-scroll', () => ({
  scrollWithinContainer: vi.fn(),
}));

import { scrollWithinContainer } from '~/client/util/smooth-scroll';
import { watchRenderingAndReScroll } from '~/client/util/watch-rendering-and-rescroll';

import { useKeywordRescroll } from './use-keyword-rescroll';

const mockWatchRenderingAndReScroll = vi.mocked(watchRenderingAndReScroll);
const mockScrollWithinContainer = vi.mocked(scrollWithinContainer);

describe('useKeywordRescroll', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWatchRenderingAndReScroll.mockReset();
    mockWatchRenderingAndReScroll.mockReturnValue(vi.fn());
    mockScrollWithinContainer.mockReset();

    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('should call watchRenderingAndReScroll with the scroll container element', () => {
    const scrollElementRef = { current: container };

    renderHook(() => useKeywordRescroll({ scrollElementRef, key: 'page-123' }));

    expect(mockWatchRenderingAndReScroll).toHaveBeenCalledTimes(1);
    const containerArg = mockWatchRenderingAndReScroll.mock.calls[0]?.[0];
    expect(containerArg).toBe(container);
  });

  it('should pass a scrollToKeyword function as the second argument', () => {
    const scrollElementRef = { current: container };

    renderHook(() => useKeywordRescroll({ scrollElementRef, key: 'page-123' }));

    const scrollToKeyword = mockWatchRenderingAndReScroll.mock.calls[0]?.[1];
    expect(typeof scrollToKeyword).toBe('function');
  });

  it('scrollToKeyword should scroll to .highlighted-keyword within container', () => {
    const scrollElementRef = { current: container };

    renderHook(() => useKeywordRescroll({ scrollElementRef, key: 'page-123' }));

    const scrollToKeyword = mockWatchRenderingAndReScroll.mock.calls[0]?.[1];

    // Inject a highlighted-keyword element into the container
    const keyword = document.createElement('span');
    keyword.className = 'highlighted-keyword';
    container.appendChild(keyword);

    vi.spyOn(keyword, 'getBoundingClientRect').mockReturnValue({
      top: 250,
      bottom: 270,
      left: 0,
      right: 100,
      width: 100,
      height: 20,
      x: 0,
      y: 250,
      toJSON: () => ({}),
    });
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 600,
      left: 0,
      right: 100,
      width: 100,
      height: 500,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    const result = scrollToKeyword?.();

    // distance = 250 - 100 - 30 = 120
    expect(mockScrollWithinContainer).toHaveBeenCalledWith(container, 120);
    expect(result).toBe(true);
  });

  it('scrollToKeyword should return false when no .highlighted-keyword element exists', () => {
    const scrollElementRef = { current: container };

    renderHook(() => useKeywordRescroll({ scrollElementRef, key: 'page-123' }));

    const scrollToKeyword = mockWatchRenderingAndReScroll.mock.calls[0]?.[1];
    const result = scrollToKeyword?.();

    expect(result).toBe(false);
    expect(mockScrollWithinContainer).not.toHaveBeenCalled();
  });

  it('should set up a MutationObserver on the container', () => {
    const scrollElementRef = { current: container };
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');

    renderHook(() => useKeywordRescroll({ scrollElementRef, key: 'page-123' }));

    expect(observeSpy).toHaveBeenCalledWith(container, {
      childList: true,
      subtree: true,
    });

    observeSpy.mockRestore();
  });

  it('should call watchRenderingAndReScroll cleanup when hook unmounts', () => {
    const mockCleanup = vi.fn();
    mockWatchRenderingAndReScroll.mockReturnValue(mockCleanup);

    const scrollElementRef = { current: container };

    const { unmount } = renderHook(() =>
      useKeywordRescroll({ scrollElementRef, key: 'page-123' }),
    );

    unmount();

    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('should disconnect MutationObserver when hook unmounts', () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

    const scrollElementRef = { current: container };

    const { unmount } = renderHook(() =>
      useKeywordRescroll({ scrollElementRef, key: 'page-123' }),
    );

    unmount();

    expect(disconnectSpy).toHaveBeenCalled();

    disconnectSpy.mockRestore();
  });

  it('should re-run effect when key changes', () => {
    const scrollElementRef = { current: container };

    const { rerender } = renderHook(
      ({ key }) => useKeywordRescroll({ scrollElementRef, key }),
      { initialProps: { key: 'page-1' } },
    );

    expect(mockWatchRenderingAndReScroll).toHaveBeenCalledTimes(1);

    rerender({ key: 'page-2' });

    expect(mockWatchRenderingAndReScroll).toHaveBeenCalledTimes(2);
  });

  it('should do nothing when scrollElementRef.current is null', () => {
    const scrollElementRef = { current: null as HTMLElement | null };

    renderHook(() => useKeywordRescroll({ scrollElementRef, key: 'page-123' }));

    expect(mockWatchRenderingAndReScroll).not.toHaveBeenCalled();
  });
});
