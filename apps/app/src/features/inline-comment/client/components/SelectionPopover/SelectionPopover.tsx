/**
 * Places arbitrary children next to a DOM Range (a text selection) — purely a
 * positioning shell with no knowledge of quotes, anchors, or comments.
 *
 * Children are rendered through a portal into `document.body` so the popover
 * escapes the stacking context (and any `overflow: hidden`) of the page-body
 * ancestors it floats over.
 */

import type { JSX, ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import type { VirtualElement } from '@popperjs/core';
import { createPortal } from 'react-dom';

import { rangeToVirtualElement } from './selection-virtual-element';
import { usePopperPosition } from './use-popper-position';

type ReferenceRect = ReturnType<VirtualElement['getBoundingClientRect']>;

const isZeroRect = (rect: ReferenceRect): boolean =>
  rect.width === 0 && rect.height === 0;

type SelectionPopoverProps = {
  /** The range the popover is positioned against. */
  range: Range;
  children: ReactNode;
};

export const SelectionPopover = (
  props: SelectionPopoverProps,
): JSX.Element | null => {
  const { range, children } = props;

  // A state-backed callback ref, not useRef: `usePopperPosition` takes the
  // popper element as an effect dependency, so the element becoming available
  // has to trigger a re-render or Popper would never be created.
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(
    null,
  );

  // Deliberately not reset when `range` changes: if a new range's very first
  // rect read is already degenerate, keeping the previous selection's position
  // leaves the popover roughly where the user was looking, whereas resetting
  // would collapse it to the viewport origin.
  const lastValidRectRef = useRef<ReferenceRect | null>(null);

  // Memoized per range because `usePopperPosition` recreates the Popper
  // instance whenever the reference identity changes.
  const virtualElement = useMemo<VirtualElement>(() => {
    const rangeElement = rangeToVirtualElement(range);

    return {
      getBoundingClientRect: () => {
        const rect = rangeElement.getBoundingClientRect();

        // A zero rect means the range no longer resolves to laid-out content;
        // handing that to Popper would snap the popover to the viewport origin.
        if (isZeroRect(rect)) {
          return lastValidRectRef.current ?? rect;
        }

        lastValidRectRef.current = rect;
        return rect;
      },
    };
  }, [range]);

  usePopperPosition(virtualElement, popperElement);

  return createPortal(
    // zIndex is the one style this element owns (Popper writes position/transform
    // itself). Some page-layout ancestors set an explicit z-index with no
    // stacking context to contain it, so without this the portal would paint
    // behind them. 1070 mirrors Bootstrap's $zindex-popover.
    <div ref={setPopperElement} style={{ zIndex: 1070 }}>
      {children}
    </div>,
    document.body,
  );
};
