// @vitest-environment happy-dom

import type { VirtualElement } from '@popperjs/core';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePopperPosition } from './use-popper-position';

const mockDestroy = vi.fn();
const mockCreatePopper = vi.fn(
  (_reference: unknown, _popper: unknown, _options: unknown) => ({
    destroy: mockDestroy,
    update: vi.fn(),
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
});
