import {
  rangeToEdgeVirtualElement,
  rangeToVirtualElement,
} from './selection-virtual-element';

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

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect =>
  ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }) as DOMRect;

type FakeRangeInit = {
  bounds: DOMRect;
  /** Client rects of the whole range, in document order (one per line box). */
  lineRects?: DOMRect[];
  /** Client rect a collapsed caret at each edge reports; absent means none. */
  caretRects?: { start?: DOMRect; end?: DOMRect };
};

/** A Range stand-in whose collapsed clone reports the caret rect of the edge it was collapsed to. */
const fakeRange = (init: FakeRangeInit): Range => {
  const { bounds, lineRects = [], caretRects = {} } = init;
  return {
    getBoundingClientRect: () => bounds,
    getClientRects: () => lineRects,
    cloneRange: () => {
      let collapsedToStart = true;
      return {
        collapse: (toStart: boolean) => {
          collapsedToStart = toStart;
        },
        getClientRects: () => {
          const caret = collapsedToStart ? caretRects.start : caretRects.end;
          return caret == null ? [] : [caret];
        },
      };
    },
  } as unknown as Range;
};

describe('rangeToEdgeVirtualElement', () => {
  // A two-line selection: line 1 spans x 10..300, line 2 spans x 10..120.
  const bounds = rect(10, 100, 290, 40);
  const lineRects = [rect(10, 100, 290, 20), rect(10, 120, 110, 20)];

  const edgeRect = (range: Range, edge: 'start' | 'end'): DOMRect =>
    rangeToEdgeVirtualElement(range, edge).getBoundingClientRect() as DOMRect;

  it('is a zero-width rect at the end caret x, spanning the selection vertically, for the end edge', () => {
    const range = fakeRange({
      bounds,
      lineRects,
      caretRects: { end: rect(120, 120, 0, 20) },
    });

    expect(edgeRect(range, 'end')).toMatchObject({
      left: 120,
      right: 120,
      width: 0,
      top: 100,
      bottom: 140,
      height: 40,
    });
  });

  it('is a zero-width rect at the start caret x for the start edge', () => {
    const range = fakeRange({
      bounds,
      lineRects,
      caretRects: { start: rect(10, 100, 0, 20) },
    });

    expect(edgeRect(range, 'start')).toMatchObject({
      left: 10,
      right: 10,
      width: 0,
      top: 100,
    });
  });

  it('falls back to the last line right edge when the end caret reports no rect', () => {
    const range = fakeRange({ bounds, lineRects });

    expect(edgeRect(range, 'end')).toMatchObject({
      left: 120,
      width: 0,
      top: 100,
      bottom: 140,
    });
  });

  it('falls back to the first line left edge when the start caret reports no rect', () => {
    const range = fakeRange({ bounds, lineRects });

    expect(edgeRect(range, 'start')).toMatchObject({
      left: 10,
      width: 0,
      top: 100,
      bottom: 140,
    });
  });

  // e.g. a triple-click selection ends at offset 0 of the next block, whose
  // caret sits on a line below the selected text.
  it('ignores an end caret that lies below the selection and uses the last line right edge instead', () => {
    const range = fakeRange({
      bounds,
      lineRects,
      caretRects: { end: rect(10, 140, 0, 20) },
    });

    expect(edgeRect(range, 'end')).toMatchObject({
      left: 120,
      top: 100,
      bottom: 140,
    });
  });

  it('uses the bounding rect edge when the range reports no line rects at all', () => {
    const range = fakeRange({ bounds });

    expect(edgeRect(range, 'end')).toMatchObject({
      left: 300,
      width: 0,
      top: 100,
      bottom: 140,
    });
    expect(edgeRect(range, 'start')).toMatchObject({
      left: 10,
      width: 0,
      top: 100,
      bottom: 140,
    });
  });

  it('returns the degenerate range rect untouched so callers can detect a range that no longer has layout', () => {
    const zero = rect(0, 0, 0, 0);
    const range = fakeRange({
      bounds: zero,
      caretRects: { end: rect(5, 5, 0, 5) },
    });

    expect(edgeRect(range, 'end')).toBe(zero);
  });

  it('re-reads the range on every call so the position follows scrolling', () => {
    let current = rect(10, 100, 290, 20);
    const range = {
      getBoundingClientRect: () => current,
      getClientRects: () => [current],
      cloneRange: () => ({
        collapse: () => undefined,
        getClientRects: () => [rect(current.right, current.top, 0, 20)],
      }),
    } as unknown as Range;
    const element = rangeToEdgeVirtualElement(range, 'end');

    expect(element.getBoundingClientRect()).toMatchObject({
      left: 300,
      top: 100,
    });

    current = rect(10, 400, 290, 20);

    expect(element.getBoundingClientRect()).toMatchObject({
      left: 300,
      top: 400,
    });
  });
});
