import { computeWidthFromPointer, isCollapseGesture } from './compute-width';

describe('computeWidthFromPointer', () => {
  it('uses the pointer x as the width for a left-anchored area', () => {
    expect(
      computeWidthFromPointer({
        anchor: 'left',
        pointerX: 420,
        viewportWidth: 1280,
        minWidth: 348,
      }),
    ).toBe(420);
  });

  it('uses the distance from the right edge as the width for a right-anchored area', () => {
    expect(
      computeWidthFromPointer({
        anchor: 'right',
        pointerX: 780,
        viewportWidth: 1280,
        minWidth: 360,
      }),
    ).toBe(500);
  });

  it('never returns less than minWidth', () => {
    expect(
      computeWidthFromPointer({
        anchor: 'left',
        pointerX: 10,
        viewportWidth: 1280,
        minWidth: 348,
      }),
    ).toBe(348);
    expect(
      computeWidthFromPointer({
        anchor: 'right',
        pointerX: 1275,
        viewportWidth: 1280,
        minWidth: 360,
      }),
    ).toBe(360);
  });

  it('caps the width at maxWidth when given', () => {
    expect(
      computeWidthFromPointer({
        anchor: 'right',
        pointerX: 100,
        viewportWidth: 1280,
        minWidth: 360,
        maxWidth: 960,
      }),
    ).toBe(960);
  });

  it('has no upper bound when maxWidth is omitted', () => {
    expect(
      computeWidthFromPointer({
        anchor: 'left',
        pointerX: 3000,
        viewportWidth: 1280,
        minWidth: 348,
      }),
    ).toBe(3000);
  });

  it('prefers minWidth when maxWidth is smaller than minWidth', () => {
    expect(
      computeWidthFromPointer({
        anchor: 'right',
        pointerX: 100,
        viewportWidth: 500,
        minWidth: 360,
        maxWidth: 200,
      }),
    ).toBe(360);
  });
});

describe('isCollapseGesture', () => {
  const base = { viewportWidth: 1280, minWidth: 348 } as const;

  it('is true when the raw width is below half of minWidth', () => {
    expect(isCollapseGesture({ ...base, anchor: 'left', pointerX: 173 })).toBe(
      true,
    );
    expect(
      isCollapseGesture({ ...base, anchor: 'right', pointerX: 1280 - 173 }),
    ).toBe(true);
  });

  it('is false at exactly half of minWidth', () => {
    expect(isCollapseGesture({ ...base, anchor: 'left', pointerX: 174 })).toBe(
      false,
    );
  });

  it('is false for a width between half of minWidth and minWidth (clamp territory)', () => {
    expect(isCollapseGesture({ ...base, anchor: 'left', pointerX: 300 })).toBe(
      false,
    );
  });
});
