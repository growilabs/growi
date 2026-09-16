import type { VirtualElement } from '@popperjs/core';

/**
 * Converts a DOM Range into a Popper "virtual element" (an object that only
 * implements getBoundingClientRect()), per the official pattern at
 * https://popper.js.org/docs/v2/virtual-elements/.
 *
 * `range.getBoundingClientRect()` is delegated to on every call rather than
 * being read once here, so a Range obtained via Range.cloneRange() keeps
 * tracking the live document position (e.g. after scrolling) — a cloned
 * Range stays attached to the document and its rect reflects current layout
 * on each call.
 */
export function rangeToVirtualElement(range: Range): VirtualElement {
  return {
    getBoundingClientRect: () => range.getBoundingClientRect(),
  };
}
