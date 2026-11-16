import { act, render, screen } from '@testing-library/react';

import {
  type FakeResizeObserverControl,
  installFakeResizeObserver,
  removeResizeObserver,
  stubElementWidths,
} from './layout-test-utils';
import { useFittingCollapseLevel } from './use-fitting-collapse-level';

const MAX_COLLAPSE_LEVEL = 2;
// Width the path content needs at each collapse level (level 0 = widest)
const CONTENT_WIDTHS = [300, 200, 100];

type ProbeProps = {
  readonly maxCollapseLevel?: number;
  readonly resetKey?: string;
  readonly onRender?: (collapseLevel: number) => void;
};

const Probe = ({
  maxCollapseLevel = MAX_COLLAPSE_LEVEL,
  resetKey = '/a/b/c/d/leaf',
  onRender,
}: ProbeProps): JSX.Element => {
  const { containerRef, shrinkableRef, collapseLevel } =
    useFittingCollapseLevel(maxCollapseLevel, resetKey);
  onRender?.(collapseLevel);
  return (
    <span
      ref={containerRef}
      data-testid="container"
      data-collapse-level={collapseLevel}
    >
      <strong ref={shrinkableRef} data-testid="shrinkable">
        leaf
      </strong>
    </span>
  );
};

const renderedCollapseLevel = (): number =>
  Number(screen.getByTestId('container').dataset.collapseLevel);

describe('useFittingCollapseLevel', () => {
  // Layout model driven by the test: the container is given `availableWidth`
  // and needs CONTENT_WIDTHS[level] for the level it currently renders.
  let availableWidth: number;
  let shrinkableOverflows: boolean;
  let restoreWidths: () => void;

  beforeEach(() => {
    availableWidth = 1000;
    shrinkableOverflows = false;
    restoreWidths = stubElementWidths((element) => {
      if (element.dataset.testid === 'container') {
        const level = Number(element.dataset.collapseLevel);
        return {
          scrollWidth: Math.max(CONTENT_WIDTHS[level], availableWidth),
          clientWidth: availableWidth,
        };
      }
      if (element.dataset.testid === 'shrinkable') {
        return shrinkableOverflows
          ? { scrollWidth: 120, clientWidth: 80 }
          : { scrollWidth: 80, clientWidth: 80 };
      }
      return undefined;
    });
  });

  afterEach(() => {
    restoreWidths();
  });

  describe('initial fitting', () => {
    let resizeObserver: FakeResizeObserverControl;

    beforeEach(() => {
      resizeObserver = installFakeResizeObserver();
    });

    afterEach(() => {
      resizeObserver.restore();
    });

    it('stays at level 0 when the base form fits', () => {
      availableWidth = 400;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(0);
    });

    it('steps up only until the content fits', () => {
      availableWidth = 250;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(1);
    });

    it('steps up to the maximum level while the container overflows', () => {
      availableWidth = 150;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(2);
    });

    it('stops at the maximum level even if it still overflows', () => {
      availableWidth = 50;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(MAX_COLLAPSE_LEVEL);
    });

    it('respects a smaller maximum level', () => {
      availableWidth = 50;
      render(<Probe maxCollapseLevel={1} />);
      expect(renderedCollapseLevel()).toBe(1);
    });

    it('steps up while the shrinkable element overflows even if the container fits', () => {
      availableWidth = 400;
      shrinkableOverflows = true;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(MAX_COLLAPSE_LEVEL);
    });

    it('does not collapse for a 1px overflow caused by width rounding', () => {
      // CONTENT_WIDTHS[0] is 300: scrollWidth 300 vs clientWidth 299
      availableWidth = 299;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(0);
    });

    it('goes back to level 0 when the path changes', () => {
      availableWidth = 150;
      const { rerender } = render(<Probe resetKey="/a/b/c/d/leaf" />);
      expect(renderedCollapseLevel()).toBe(2);

      // The new path fits in its base form
      availableWidth = 400;
      rerender(<Probe resetKey="/x/leaf" />);
      expect(renderedCollapseLevel()).toBe(0);
    });
  });

  describe('container width changes', () => {
    let resizeObserver: FakeResizeObserverControl;

    beforeEach(() => {
      resizeObserver = installFakeResizeObserver();
    });

    afterEach(() => {
      resizeObserver.restore();
    });

    const notifyWidth = (width: number): void => {
      act(() => {
        resizeObserver.notifyResize(screen.getByTestId('container'), width);
      });
    };

    it('ignores a notification that reports the width the path was fitted at', () => {
      const renderedLevels: number[] = [];
      availableWidth = 250;
      render(<Probe onRender={(level) => renderedLevels.push(level)} />);
      expect(renderedCollapseLevel()).toBe(1);

      renderedLevels.length = 0;
      notifyWidth(250);
      expect(renderedCollapseLevel()).toBe(1);
      expect(renderedLevels).toEqual([]);
    });

    it('re-fits from level 0 when the width grew before the first notification arrived', () => {
      availableWidth = 250;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(1);

      // The observer starts after the fitting; the container has widened meanwhile
      availableWidth = 1000;
      notifyWidth(1000);
      expect(renderedCollapseLevel()).toBe(0);
    });

    it('re-checks from level 0 when the container widens', () => {
      availableWidth = 150;
      render(<Probe />);
      notifyWidth(150);
      expect(renderedCollapseLevel()).toBe(2);

      availableWidth = 250;
      notifyWidth(250);
      expect(renderedCollapseLevel()).toBe(1);

      availableWidth = 400;
      notifyWidth(400);
      expect(renderedCollapseLevel()).toBe(0);
    });

    it('re-checks from the current level when the container narrows', () => {
      const renderedLevels: number[] = [];
      availableWidth = 400;
      render(<Probe onRender={(level) => renderedLevels.push(level)} />);
      notifyWidth(400);
      expect(renderedCollapseLevel()).toBe(0);

      availableWidth = 250;
      notifyWidth(250);
      expect(renderedCollapseLevel()).toBe(1);

      renderedLevels.length = 0;
      availableWidth = 150;
      notifyWidth(150);
      expect(renderedCollapseLevel()).toBe(2);
      // Narrowing must not restart from the base form
      expect(renderedLevels).not.toContain(0);
    });
  });

  describe('without ResizeObserver', () => {
    let restoreResizeObserver: () => void;

    beforeEach(() => {
      restoreResizeObserver = removeResizeObserver();
    });

    afterEach(() => {
      restoreResizeObserver();
    });

    it('still performs the initial fitting without throwing', () => {
      expect(globalThis.ResizeObserver).toBeUndefined();
      availableWidth = 150;
      render(<Probe />);
      expect(renderedCollapseLevel()).toBe(2);
    });
  });
});
