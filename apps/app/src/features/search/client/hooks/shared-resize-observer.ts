type WidthListener = (width: number) => void;

const listeners = new Map<Element, WidthListener>();

let sharedObserver: ResizeObserver | undefined;

// Same box as `useResizeObserver`'s default: the content-box width
const readContentWidth = (entry: ResizeObserverEntry): number =>
  entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;

const getSharedObserver = (): ResizeObserver => {
  sharedObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      listeners.get(entry.target)?.(readContentWidth(entry));
    }
  });
  return sharedObserver;
};

/**
 * Calls `listener` with the content-box width of `element` whenever the
 * browser reports a resize (including the initial report after observing).
 *
 * A search page can render hundreds of paths, so every element is observed by
 * one shared ResizeObserver, which exists while at least one element is
 * observed. Each element still gets its own width, since rows can differ.
 * Does nothing where ResizeObserver is unavailable. Returns the function that
 * stops observing.
 */
export const observeElementWidth = (
  element: Element,
  listener: WidthListener,
): (() => void) => {
  if (globalThis.ResizeObserver == null) return () => {};

  const observer = getSharedObserver();
  listeners.set(element, listener);
  observer.observe(element);

  return () => {
    listeners.delete(element);
    observer.unobserve(element);
    if (listeners.size === 0 && sharedObserver === observer) {
      observer.disconnect();
      sharedObserver = undefined;
    }
  };
};
