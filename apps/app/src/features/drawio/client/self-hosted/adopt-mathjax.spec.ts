// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableJavaScriptFileLoading": true } }

import { adoptMathJax, suppressBakedMathJax } from './adopt-mathjax';

const BAKED = 'https://viewer.diagrams.net/math4/es5';
const DRAWIO_URI = 'http://localhost:8080/?offline=1&https=0';
const RELOCATED = 'http://localhost:8080/math4/es5';

/**
 * Stand-in for what viewer-static.min.js does at the bottom of the bundle: publish the
 * baked-in location, then call Editor.initMath(), which only acts while window.MathJax is
 * undefined and appends a startup script for wherever DRAW_MATH_URL points.
 */
const loadViewerBundle = (): void => {
  window.DRAW_MATH_URL ??= BAKED;

  const initMath = (startupUrl?: string): void => {
    if (typeof window.MathJax !== 'undefined') {
      return;
    }
    window.MathJax = {
      loader: { paths: { fonts: `${window.DRAW_MATH_URL}/fonts` } },
    };
    const script = document.createElement('script');
    script.src = startupUrl ?? `${window.DRAW_MATH_URL}/startup.js`;
    document.head.appendChild(script);
  };

  window.Editor = { initMath };
  initMath();
};

const startupSrcs = (): string[] =>
  Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[src*="startup.js"]'),
  ).map((el) => el.getAttribute('src') ?? '');

describe('self-hosted MathJax adoption', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    window.DRAW_MATH_URL = undefined;
    window.MathJax = undefined;
    window.Editor = undefined;
  });

  describe('suppressBakedMathJax', () => {
    it('should stop the bundle from requesting the baked-in location at all', () => {
      // the baked-in location is often reachable (draw.io v29+ bakes in a path that still
      // exists upstream), and a script whose fetch has started cannot be called off, so
      // the only reliable move is to never let it be appended
      suppressBakedMathJax();

      loadViewerBundle();

      expect(startupSrcs()).toHaveLength(0);
    });

    it('should leave a MathJax configuration that is already present untouched', () => {
      const existing = { loader: { paths: { fonts: 'somewhere' } } };
      window.MathJax = existing;

      suppressBakedMathJax();

      expect(window.MathJax).toBe(existing);
    });
  });

  describe('adoptMathJax', () => {
    it('should boot MathJax from the configured instance', () => {
      suppressBakedMathJax();
      loadViewerBundle();

      adoptMathJax(DRAWIO_URI);

      expect(startupSrcs()).toEqual([`${RELOCATED}/startup.js`]);
    });

    it('should boot MathJax exactly once, so the second boot cannot break the first', () => {
      suppressBakedMathJax();
      loadViewerBundle();

      adoptMathJax(DRAWIO_URI);

      // every startup script has to come from the configured instance and nowhere else;
      // comparing origins rather than matching a substring states exactly that
      expect(startupSrcs().map((src) => new URL(src).origin)).toEqual([
        new URL(DRAWIO_URI).origin,
      ]);
    });

    it('should repoint DRAW_MATH_URL, which the font path is derived from', () => {
      suppressBakedMathJax();
      loadViewerBundle();

      adoptMathJax(DRAWIO_URI);

      expect(window.DRAW_MATH_URL).toBe(RELOCATED);
      expect(window.MathJax?.loader?.paths?.fonts).toBe(`${RELOCATED}/fonts`);
    });

    it('should reuse the baked-in directory so the draw.io version needs no detecting', () => {
      // draw.io moved MathJax from math/es5 to math4/es5 in v29, and an instance ships
      // only the one its own version expects
      window.DRAW_MATH_URL = 'https://viewer.diagrams.net/math/es5';
      suppressBakedMathJax();
      loadViewerBundle();

      adoptMathJax(DRAWIO_URI);

      expect(startupSrcs()).toEqual([
        'http://localhost:8080/math/es5/startup.js',
      ]);
    });

    describe('when the baked-in location cannot be read', () => {
      // Nothing to relocate onto, so draw.io has to end up exactly as it would have been
      // without any of this — including not carrying a suppression that would both break
      // math outright and leave a stray global behind.
      it("should put draw.io back to its own behaviour, asking for draw.io's location", () => {
        suppressBakedMathJax();
        const initMath = vi.fn();
        window.Editor = { initMath };

        adoptMathJax(DRAWIO_URI);

        expect(initMath).toHaveBeenCalledWith(undefined);
      });

      it('should leave no suppression behind', () => {
        suppressBakedMathJax();
        window.Editor = { initMath: vi.fn() };

        adoptMathJax(DRAWIO_URI);

        expect(window.MathJax).toBeUndefined();
      });
    });

    it('should not throw when the bundle exposes no Editor', () => {
      window.DRAW_MATH_URL = BAKED;

      expect(() => adoptMathJax(DRAWIO_URI)).not.toThrow();
    });
  });
});
