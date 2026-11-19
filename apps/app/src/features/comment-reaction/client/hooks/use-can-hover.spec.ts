// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { useCanHover } from './use-can-hover';

const HOVER_QUERY = '(hover: hover)';

// A stand-in for the browser's media query whose answer the test can flip.
const stubHoverQuery = (initial: boolean): ((next: boolean) => void) => {
  let matches = initial;
  const changes = new EventTarget();
  vi.spyOn(window, 'matchMedia').mockImplementation((media) => {
    if (media !== HOVER_QUERY) {
      throw new Error(`unexpected media query: ${media}`);
    }
    return mock<MediaQueryList>({
      media,
      matches,
      addEventListener: changes.addEventListener.bind(changes),
      removeEventListener: changes.removeEventListener.bind(changes),
    });
  });

  return (next: boolean) => {
    matches = next;
    changes.dispatchEvent(new Event('change'));
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCanHover', () => {
  it.each([
    true,
    false,
  ])('returns %s when the device answers (hover: hover) with it', (canHover) => {
    stubHoverQuery(canHover);

    const { result } = renderHook(() => useCanHover());

    expect(result.current).toBe(canHover);
  });

  it('follows the device when its answer changes', () => {
    const setCanHover = stubHoverQuery(false);
    const { result } = renderHook(() => useCanHover());

    act(() => setCanHover(true));
    expect(result.current).toBe(true);

    act(() => setCanHover(false));
    expect(result.current).toBe(false);
  });
});
