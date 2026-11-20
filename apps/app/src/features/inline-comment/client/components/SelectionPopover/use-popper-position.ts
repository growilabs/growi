import { useEffect } from 'react';
import {
  createPopper,
  type Placement,
  type VirtualElement,
} from '@popperjs/core';

/**
 * Manages the lifecycle of a `@popperjs/core` instance: creates it once both
 * the reference (a virtual element, e.g. from `rangeToVirtualElement`) and
 * the popper DOM element are available, and destroys it on cleanup.
 *
 * A ResizeObserver re-runs Popper's position computation when the popper
 * element changes size, so content that grows (a multi-line form) stays
 * anchored on the reference side instead of spilling over it.
 *
 * Only the standard `flip` / `preventOverflow` / `offset` modifiers are used (no custom modifiers).
 *
 * `virtualElement` and `popperElement` are expected to change identity
 * across renders (a new Range-backed virtual element per selection change, a
 * popper DOM node that only exists once the portal/popover content mounts).
 * Destroy-and-recreate on any such change is the simplest option that stays
 * correct for both cases; `setOptions()`/`update()` only make sense once an
 * instance already exists for a stable pair of elements, which is not
 * guaranteed here.
 */
export function usePopperPosition(
  virtualElement: VirtualElement | null,
  popperElement: HTMLElement | null,
  placement: Placement = 'bottom',
): void {
  useEffect(() => {
    if (virtualElement == null || popperElement == null) {
      return;
    }

    const instance = createPopper(virtualElement, popperElement, {
      placement,
      modifiers: [
        { name: 'flip' },
        { name: 'preventOverflow' },
        { name: 'offset', options: { offset: [0, 8] } },
      ],
    });

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            void instance.update();
          });
    resizeObserver?.observe(popperElement);

    return () => {
      resizeObserver?.disconnect();
      instance.destroy();
    };
  }, [virtualElement, popperElement, placement]);
}
