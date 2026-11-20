type Listener = () => void;

const listeners = new Set<Listener>();

// The FontFaceSet the shared listener is attached to; kept so the listener is
// removed from the same object it was added to.
let attachedFonts: FontFaceSet | undefined;

const notifyAll = (): void => {
  for (const listener of [...listeners]) {
    listener();
  }
};

/**
 * Calls `listener` whenever the document's web fonts finish loading.
 *
 * Every rendered path subscribes, and a search page can render hundreds of
 * them, so all subscribers share a single `loadingdone` listener on
 * `document.fonts` that is attached while at least one subscriber exists.
 * Returns the unsubscribe function.
 */
export const subscribeWebFontsLoaded = (listener: Listener): (() => void) => {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts == null) return () => {};

  listeners.add(listener);
  if (attachedFonts == null) {
    fonts.addEventListener('loadingdone', notifyAll);
    attachedFonts = fonts;
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && attachedFonts != null) {
      attachedFonts.removeEventListener('loadingdone', notifyAll);
      attachedFonts = undefined;
    }
  };
};
