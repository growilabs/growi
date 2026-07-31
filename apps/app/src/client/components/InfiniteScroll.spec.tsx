import { act, render } from '@testing-library/react';
import type { SWRInfiniteResponse } from 'swr/infinite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import InfiniteScroll from './InfiniteScroll';

// InfiniteScroll drives additional loading off an IntersectionObserver watching a
// sentinel element at the list tail. happy-dom's IntersectionObserver never fires,
// so we stub it and capture the callback to drive a sentinel intersection
// deterministically. This exercises the Req 1.2 mechanism (sentinel crosses the
// viewport → next chunk is requested) that SearchPage delegates to this component.
type IOEntry = { isIntersecting: boolean };
type IOCallback = (entries: IOEntry[]) => void;

const observerState = {
  callback: undefined as IOCallback | undefined,
};

class MockIntersectionObserver {
  constructor(cb: IOCallback) {
    observerState.callback = cb;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const triggerIntersection = (isIntersecting: boolean) => {
  act(() => {
    observerState.callback?.([{ isIntersecting }]);
  });
};

const createSwrResponse = (
  isValidating: boolean,
  setSize = vi.fn(),
): SWRInfiniteResponse<unknown> =>
  mock<SWRInfiniteResponse<unknown>>({ setSize, isValidating });

describe('InfiniteScroll additional loading on sentinel intersection (Req 1.2)', () => {
  beforeEach(() => {
    observerState.callback = undefined;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('requests the next chunk (advances setSize by one) when the sentinel intersects (Req 1.2)', () => {
    const setSize = vi.fn();
    const swr = createSwrResponse(false, setSize);

    render(
      <InfiniteScroll swrInifiniteResponse={swr} isReachingEnd={false}>
        <div>results</div>
      </InfiniteScroll>,
    );

    // No load is requested until the sentinel actually crosses the viewport.
    expect(setSize).not.toHaveBeenCalled();

    triggerIntersection(true);

    expect(setSize).toHaveBeenCalledTimes(1);
    // The updater must advance the loaded size by exactly one (append the next
    // chunk to the tail), not reset or skip pages.
    const updater = setSize.mock.calls[0][0] as (size: number) => number;
    expect(updater(1)).toBe(2);
  });

  it('does not request more once the end has been reached, even on intersection (Req 1.2 / 1.4 guard)', () => {
    const setSize = vi.fn();
    const swr = createSwrResponse(false, setSize);

    render(
      <InfiniteScroll swrInifiniteResponse={swr} isReachingEnd>
        <div>results</div>
      </InfiniteScroll>,
    );

    triggerIntersection(true);

    expect(setSize).not.toHaveBeenCalled();
  });

  it('does not request more while a load is already in flight (isValidating)', () => {
    const setSize = vi.fn();
    const swr = createSwrResponse(true, setSize);

    render(
      <InfiniteScroll swrInifiniteResponse={swr} isReachingEnd={false}>
        <div>results</div>
      </InfiniteScroll>,
    );

    triggerIntersection(true);

    expect(setSize).not.toHaveBeenCalled();
  });
});
