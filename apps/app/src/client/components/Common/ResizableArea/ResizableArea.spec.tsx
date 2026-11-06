// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';

import type { ResizableAreaProps } from './props';
import { ResizableArea } from './ResizableArea';

const VIEWPORT_WIDTH = 1280;

// happy-dom performs no layout, so the viewport width the component reads has
// to be pinned explicitly.
beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: VIEWPORT_WIDTH,
  });
});

const renderArea = (props: Partial<ResizableAreaProps> = {}) => {
  const onResize = vi.fn();
  const onResizeDone = vi.fn();
  render(
    <ResizableArea
      width={500}
      minWidth={360}
      onResize={onResize}
      onResizeDone={onResizeDone}
      {...props}
    >
      <div>content</div>
    </ResizableArea>,
  );
  return { onResize, onResizeDone };
};

const getHandle = () => screen.getByRole('button', { name: 'Resize sidebar' });

const drag = (toClientX: number) => {
  fireEvent.mouseDown(getHandle(), { clientX: 0 });
  fireEvent.mouseMove(document, { clientX: toClientX });
};

const release = (atClientX: number) => {
  fireEvent.mouseUp(document, { clientX: atClientX });
};

describe('ResizableArea (anchor="right")', () => {
  it('reports the distance from the right viewport edge while dragging', () => {
    const { onResize } = renderArea({ anchor: 'right' });

    drag(VIEWPORT_WIDTH - 640);

    expect(onResize).toHaveBeenLastCalledWith(640);
  });

  it('confirms the last dragged width on release', () => {
    const { onResizeDone } = renderArea({ anchor: 'right' });

    drag(VIEWPORT_WIDTH - 640);
    release(VIEWPORT_WIDTH - 640);

    expect(onResizeDone).toHaveBeenCalledTimes(1);
    expect(onResizeDone).toHaveBeenCalledWith(640);
  });

  it('caps the width at maxWidth', () => {
    const { onResize, onResizeDone } = renderArea({
      anchor: 'right',
      maxWidth: 960,
    });

    drag(10);
    release(10);

    expect(onResize).toHaveBeenLastCalledWith(960);
    expect(onResizeDone).toHaveBeenCalledWith(960);
  });

  it('clamps to minWidth instead of collapsing when onCollapsed is not given', () => {
    const { onResize, onResizeDone } = renderArea({ anchor: 'right' });

    // far below minWidth / 2 — would be a collapse gesture for the left sidebar
    drag(VIEWPORT_WIDTH - 20);
    release(VIEWPORT_WIDTH - 20);

    expect(onResize).toHaveBeenLastCalledWith(360);
    expect(onResizeDone).toHaveBeenCalledWith(360);
  });

  it('does not confirm a width when the handle is released without moving', () => {
    const { onResize, onResizeDone } = renderArea({ anchor: 'right' });

    fireEvent.mouseDown(getHandle(), { clientX: VIEWPORT_WIDTH - 500 });
    release(VIEWPORT_WIDTH - 500);

    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeDone).not.toHaveBeenCalled();
  });
});

describe('ResizableArea (default anchor, left sidebar compatibility)', () => {
  it('uses the pointer x as the width', () => {
    const { onResize, onResizeDone } = renderArea({ minWidth: 348 });

    drag(420);
    release(420);

    expect(onResize).toHaveBeenLastCalledWith(420);
    expect(onResizeDone).toHaveBeenCalledWith(420);
  });

  it('collapses instead of confirming a width when released below half of minWidth', () => {
    const onCollapsed = vi.fn();
    const { onResizeDone } = renderArea({ minWidth: 348, onCollapsed });

    drag(100);
    release(100);

    expect(onCollapsed).toHaveBeenCalledTimes(1);
    expect(onResizeDone).not.toHaveBeenCalled();
  });

  it('confirms the width when released above half of minWidth even with onCollapsed', () => {
    const onCollapsed = vi.fn();
    const { onResizeDone } = renderArea({ minWidth: 348, onCollapsed });

    drag(200);
    release(200);

    expect(onCollapsed).not.toHaveBeenCalled();
    expect(onResizeDone).toHaveBeenCalledWith(348);
  });
});

describe('ResizableArea (disabled)', () => {
  it('renders no resize handle', () => {
    renderArea({ anchor: 'right', disabled: true });

    expect(screen.queryByRole('button', { name: 'Resize sidebar' })).toBeNull();
  });
});
