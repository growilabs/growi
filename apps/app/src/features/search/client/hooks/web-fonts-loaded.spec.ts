import { subscribeWebFontsLoaded } from './web-fonts-loaded';

// A font set that reports how many listeners are currently registered on it,
// which is the cost this module exists to bound.
class FakeFontSet extends EventTarget {
  registeredListeners = 0;

  override addEventListener(
    ...args: Parameters<EventTarget['addEventListener']>
  ): void {
    this.registeredListeners += 1;
    super.addEventListener(...args);
  }

  override removeEventListener(
    ...args: Parameters<EventTarget['removeEventListener']>
  ): void {
    this.registeredListeners -= 1;
    super.removeEventListener(...args);
  }

  finishLoading(): void {
    this.dispatchEvent(new Event('loadingdone'));
  }
}

describe('subscribeWebFontsLoaded', () => {
  let fonts: FakeFontSet;

  beforeEach(() => {
    fonts = new FakeFontSet();
    vi.stubGlobal('document', { fonts });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies every subscriber through a single listener on the font set', () => {
    const subscribers = Array.from({ length: 200 }, () => vi.fn());
    const unsubscribes = subscribers.map((s) => subscribeWebFontsLoaded(s));

    expect(fonts.registeredListeners).toBe(1);

    fonts.finishLoading();
    for (const subscriber of subscribers) {
      expect(subscriber).toHaveBeenCalledTimes(1);
    }

    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  });

  it('stops notifying a subscriber after it unsubscribes', () => {
    const kept = vi.fn();
    const removed = vi.fn();
    const unsubscribeKept = subscribeWebFontsLoaded(kept);
    const unsubscribeRemoved = subscribeWebFontsLoaded(removed);

    unsubscribeRemoved();
    fonts.finishLoading();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();

    unsubscribeKept();
  });

  it('removes the listener from the font set once the last subscriber leaves', () => {
    const unsubscribeA = subscribeWebFontsLoaded(vi.fn());
    const unsubscribeB = subscribeWebFontsLoaded(vi.fn());

    unsubscribeA();
    expect(fonts.registeredListeners).toBe(1);

    unsubscribeB();
    expect(fonts.registeredListeners).toBe(0);
  });

  it('attaches again after every subscriber has left', () => {
    subscribeWebFontsLoaded(vi.fn())();

    const subscriber = vi.fn();
    const unsubscribe = subscribeWebFontsLoaded(subscriber);
    fonts.finishLoading();

    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does nothing when the font loading API is unavailable', () => {
    vi.stubGlobal('document', {});
    const subscriber = vi.fn();

    expect(() => subscribeWebFontsLoaded(subscriber)()).not.toThrow();
  });
});
