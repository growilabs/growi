/**
 * Test-only helpers that give a layout-less DOM (happy-dom / jsdom) the element
 * widths and ResizeObserver notifications that width-dependent UI relies on.
 * Shared by the `useFittingCollapseLevel` spec and the component specs that use it.
 */

export interface ElementWidths {
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** Returns the widths for an element, or undefined to fall back to 0 / 0. */
export type ElementWidthResolver = (
  element: HTMLElement,
) => ElementWidths | undefined;

type WidthProperty = keyof ElementWidths;

const WIDTH_PROPERTIES: readonly WidthProperty[] = [
  'scrollWidth',
  'clientWidth',
];

/**
 * Makes `scrollWidth` / `clientWidth` of every HTMLElement come from `resolve`.
 * Stubbed on the prototype (not per element) because a hook measures inside a
 * layout effect that runs during `render()`, before a test could reach the
 * element. The resolver is evaluated on every read, so tests can change widths
 * between renders. Returns a function that restores the original properties.
 */
export const stubElementWidths = (
  resolve: ElementWidthResolver,
): (() => void) => {
  const prototype = HTMLElement.prototype;
  const originals = WIDTH_PROPERTIES.map(
    (property) =>
      [property, Object.getOwnPropertyDescriptor(prototype, property)] as const,
  );

  for (const property of WIDTH_PROPERTIES) {
    Object.defineProperty(prototype, property, {
      configurable: true,
      get(this: HTMLElement): number {
        return resolve(this)?.[property] ?? 0;
      },
    });
  }

  return () => {
    for (const [property, descriptor] of originals) {
      if (descriptor == null) {
        Reflect.deleteProperty(prototype, property);
      } else {
        Object.defineProperty(prototype, property, descriptor);
      }
    }
  };
};

export interface FakeResizeObserverControl {
  /**
   * Delivers a notification with the given content width to every observer of
   * `element`. The first call after observing starts plays the role of the
   * browser's initial notification.
   */
  readonly notifyResize: (element: Element, width: number) => void;
  /** Restores the global ResizeObserver that existed before installing. */
  readonly restore: () => void;
}

const createRectReadOnly = (width: number): DOMRectReadOnly => ({
  x: 0,
  y: 0,
  width,
  height: 0,
  top: 0,
  right: width,
  bottom: 0,
  left: 0,
  toJSON: () => ({ x: 0, y: 0, width, height: 0 }),
});

const createEntry = (target: Element, width: number): ResizeObserverEntry => {
  const size: ResizeObserverSize = { inlineSize: width, blockSize: 0 };
  return {
    target,
    contentRect: createRectReadOnly(width),
    contentBoxSize: [size],
    borderBoxSize: [size],
    devicePixelContentBoxSize: [size],
  };
};

const replaceGlobalResizeObserver = (
  replacement: typeof ResizeObserver | undefined,
): (() => void) => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'ResizeObserver',
  );
  if (replacement == null) {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  } else {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: replacement,
    });
  }
  return () => {
    if (original == null) {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    } else {
      Object.defineProperty(globalThis, 'ResizeObserver', original);
    }
  };
};

/**
 * Replaces the global ResizeObserver with a fake whose notifications are
 * delivered only when the test calls `notifyResize`.
 */
export const installFakeResizeObserver = (): FakeResizeObserverControl => {
  const observersByTarget = new Map<Element, Set<FakeResizeObserver>>();

  class FakeResizeObserver implements ResizeObserver {
    readonly #callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }

    observe(target: Element): void {
      const observers = observersByTarget.get(target) ?? new Set();
      observersByTarget.set(target, observers.add(this));
    }

    unobserve(target: Element): void {
      observersByTarget.get(target)?.delete(this);
    }

    disconnect(): void {
      for (const observers of observersByTarget.values()) {
        observers.delete(this);
      }
    }

    deliver(target: Element, width: number): void {
      this.#callback([createEntry(target, width)], this);
    }
  }

  const restore = replaceGlobalResizeObserver(FakeResizeObserver);

  return {
    notifyResize: (element, width) => {
      for (const observer of observersByTarget.get(element) ?? []) {
        observer.deliver(element, width);
      }
    },
    restore,
  };
};

/**
 * Removes the global ResizeObserver entirely (as in older browsers or SSR).
 * Returns a function that restores it.
 */
export const removeResizeObserver = (): (() => void) =>
  replaceGlobalResizeObserver(undefined);
