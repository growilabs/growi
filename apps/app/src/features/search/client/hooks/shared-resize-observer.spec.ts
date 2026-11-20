import { mock } from 'vitest-mock-extended';

import { observeElementWidth } from './shared-resize-observer';

// Records every instance so tests can check how many observers exist and
// deliver a resize report for a single element.
class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly targets = new Set<Element>();

  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  report(target: Element, width: number): void {
    if (!this.targets.has(target)) return;
    const size: ResizeObserverSize = { inlineSize: width, blockSize: 0 };
    // A plain object: `target` must be the very element that was observed
    const entry: ResizeObserverEntry = {
      target,
      contentRect: mock<DOMRectReadOnly>({ width }),
      contentBoxSize: [size],
      borderBoxSize: [size],
      devicePixelContentBoxSize: [size],
    };
    this.#callback([entry], this);
  }
}

const reportWidth = (target: Element, width: number): void => {
  for (const observer of FakeResizeObserver.instances) {
    observer.report(target, width);
  }
};

const observingCount = (): number =>
  FakeResizeObserver.instances.reduce((sum, o) => sum + o.targets.size, 0);

describe('observeElementWidth', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes many elements with a single ResizeObserver', () => {
    const elements = Array.from({ length: 200 }, () => mock<Element>());
    const stops = elements.map((element) =>
      observeElementWidth(element, vi.fn()),
    );

    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(observingCount()).toBe(200);

    for (const stop of stops) {
      stop();
    }
  });

  it('reports each element its own width only', () => {
    const first = mock<Element>();
    const second = mock<Element>();
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    const stopFirst = observeElementWidth(first, onFirst);
    const stopSecond = observeElementWidth(second, onSecond);

    reportWidth(first, 320);

    expect(onFirst).toHaveBeenCalledWith(320);
    expect(onSecond).not.toHaveBeenCalled();

    stopFirst();
    stopSecond();
  });

  it('stops reporting an element once its observation is stopped', () => {
    const kept = mock<Element>();
    const stopped = mock<Element>();
    const onKept = vi.fn();
    const onStopped = vi.fn();
    const stopKept = observeElementWidth(kept, onKept);
    observeElementWidth(stopped, onStopped)();

    reportWidth(stopped, 100);
    reportWidth(kept, 200);

    expect(onStopped).not.toHaveBeenCalled();
    expect(onKept).toHaveBeenCalledWith(200);

    stopKept();
  });

  it('releases the observer once nothing is observed and creates a new one when needed', () => {
    observeElementWidth(mock<Element>(), vi.fn())();
    expect(observingCount()).toBe(0);

    const element = mock<Element>();
    const listener = vi.fn();
    const stop = observeElementWidth(element, listener);
    reportWidth(element, 150);

    expect(listener).toHaveBeenCalledWith(150);
    stop();
  });

  it('does nothing when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);

    expect(() => observeElementWidth(mock<Element>(), vi.fn())()).not.toThrow();
  });
});
