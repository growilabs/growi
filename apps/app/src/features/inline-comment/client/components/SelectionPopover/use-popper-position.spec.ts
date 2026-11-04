// @vitest-environment happy-dom

import type { VirtualElement } from '@popperjs/core';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePopperPosition } from './use-popper-position';

const mockDestroy = vi.fn();
const mockUpdate = vi.fn();
const mockCreatePopper = vi.fn(
  (_reference: unknown, _popper: unknown, _options: unknown) => ({
    destroy: mockDestroy,
    update: mockUpdate,
    setOptions: vi.fn(),
  }),
);

vi.mock('@popperjs/core', () => ({
  createPopper: (reference: unknown, popper: unknown, options: unknown) =>
    mockCreatePopper(reference, popper, options),
}));

// A minimal virtual element per the official Popper "virtual elements" pattern
// (only getBoundingClientRect() is required).
const buildVirtualElement = (): VirtualElement => ({
  getBoundingClientRect: () =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    }) as DOMRect,
});

describe('usePopperPosition', () => {
  beforeEach(() => {
    mockCreatePopper.mockClear();
    mockDestroy.mockClear();
    mockUpdate.mockClear();
    vi.unstubAllGlobals();
  });

  it('creates a Popper instance once when both a virtual element and a popper element are provided at mount', () => {
    const virtualElement = buildVirtualElement();
    const popperElement = document.createElement('div');

    renderHook(() => usePopperPosition(virtualElement, popperElement));

    expect(mockCreatePopper).toHaveBeenCalledTimes(1);
    expect(mockCreatePopper).toHaveBeenCalledWith(
      virtualElement,
      popperElement,
      expect.objectContaining({ modifiers: expect.any(Array) }),
    );
  });

  it('places the popper below the reference by default', () => {
    renderHook(() =>
      usePopperPosition(buildVirtualElement(), document.createElement('div')),
    );

    expect(mockCreatePopper).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ placement: 'bottom' }),
    );
  });

  it('places the popper where the caller asks', () => {
    renderHook(() =>
      usePopperPosition(
        buildVirtualElement(),
        document.createElement('div'),
        'top',
      ),
    );

    expect(mockCreatePopper).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ placement: 'top' }),
    );
  });

  it('does not create a Popper instance when the popper element is not yet available', () => {
    const virtualElement = buildVirtualElement();

    renderHook(() => usePopperPosition(virtualElement, null));

    expect(mockCreatePopper).not.toHaveBeenCalled();
  });

  it('does not create a Popper instance when the virtual element is not yet available', () => {
    const popperElement = document.createElement('div');

    renderHook(() => usePopperPosition(null, popperElement));

    expect(mockCreatePopper).not.toHaveBeenCalled();
  });

  it('calls destroy() on the Popper instance exactly once on unmount', () => {
    const virtualElement = buildVirtualElement();
    const popperElement = document.createElement('div');

    const { unmount } = renderHook(() =>
      usePopperPosition(virtualElement, popperElement),
    );

    expect(mockDestroy).not.toHaveBeenCalled();

    unmount();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  describe('when the popper element is resized', () => {
    const stubResizeObserver = () => {
      const observed: { callback: () => void; disconnect: () => void }[] = [];
      const disconnect = vi.fn();
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            observed.push({ callback, disconnect });
          }
          observe() {}
          unobserve() {}
          disconnect = disconnect;
        },
      );
      return { observed, disconnect };
    };

    it('recomputes the position, so a form that grows keeps its anchored edge', () => {
      const { observed } = stubResizeObserver();

      renderHook(() =>
        usePopperPosition(
          buildVirtualElement(),
          document.createElement('div'),
          'top',
        ),
      );
      mockUpdate.mockClear();
      observed[0].callback();

      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('stops observing on unmount', () => {
      const { disconnect } = stubResizeObserver();

      const { unmount } = renderHook(() =>
        usePopperPosition(buildVirtualElement(), document.createElement('div')),
      );
      unmount();

      expect(disconnect).toHaveBeenCalled();
    });

    it('still works in an environment without ResizeObserver', () => {
      vi.stubGlobal('ResizeObserver', undefined);

      expect(() =>
        renderHook(() =>
          usePopperPosition(
            buildVirtualElement(),
            document.createElement('div'),
          ),
        ),
      ).not.toThrow();
      expect(mockCreatePopper).toHaveBeenCalledTimes(1);
    });
  });
});
