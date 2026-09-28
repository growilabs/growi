import { rangeToVirtualElement } from './selection-virtual-element';

describe('rangeToVirtualElement', () => {
  it('delegates getBoundingClientRect() to the given Range, returning the same value', () => {
    const rect = {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      top: 20,
      right: 40,
      bottom: 60,
      left: 10,
    } as DOMRect;
    const getBoundingClientRect = vi.fn().mockReturnValue(rect);
    const mockRange = { getBoundingClientRect } as unknown as Range;

    const virtualElement = rangeToVirtualElement(mockRange);
    const result = virtualElement.getBoundingClientRect();

    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(result).toBe(rect);
  });

  it("re-invokes the Range clone's own getBoundingClientRect() on every call, so a value that changes after scrolling is followed", () => {
    const firstRect = { x: 0, y: 0 } as DOMRect;
    const secondRect = { x: 0, y: 100 } as DOMRect;
    const getBoundingClientRect = vi
      .fn()
      .mockReturnValueOnce(firstRect)
      .mockReturnValueOnce(secondRect);
    // Simulates a Range obtained via Range.cloneRange(): still attached to the
    // document, so its rect tracks live document/scroll state across calls.
    const clonedRange = { getBoundingClientRect } as unknown as Range;

    const virtualElement = rangeToVirtualElement(clonedRange);

    expect(virtualElement.getBoundingClientRect()).toBe(firstRect);
    expect(virtualElement.getBoundingClientRect()).toBe(secondRect);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
  });
});
