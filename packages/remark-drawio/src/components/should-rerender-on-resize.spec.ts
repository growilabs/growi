import { describe, expect, it } from 'vitest';

import { shouldRerenderOnResize } from './should-rerender-on-resize.js';

describe('shouldRerenderOnResize', () => {
  it('re-renders on the first observation (no previous width yet)', () => {
    expect(shouldRerenderOnResize(undefined, 800)).toBe(true);
  });

  it('re-renders when the available width changes (external layout change)', () => {
    expect(shouldRerenderOnResize(800, 600)).toBe(true);
    expect(shouldRerenderOnResize(600, 800)).toBe(true);
  });

  it('does NOT re-render when only the height changes (width is stable)', () => {
    // draw.io page navigation resizes the diagram vertically while the block's
    // width stays fixed by the surrounding layout. Re-rendering here would
    // recreate the viewer and reset multi-page navigation back to page 1.
    expect(shouldRerenderOnResize(800, 800)).toBe(false);
  });

  it('ignores sub-pixel width jitter', () => {
    expect(shouldRerenderOnResize(800.2, 800.4)).toBe(false);
    expect(shouldRerenderOnResize(800, 800.49)).toBe(false);
  });
});
