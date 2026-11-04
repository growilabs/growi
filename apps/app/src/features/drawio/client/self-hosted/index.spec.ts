// @vitest-environment happy-dom

import { DEFAULT_DRAWIO_ORIGIN, DRAWIO_ASSET_PROXY_PATH } from '../../consts';
import { adoptSelfHostedDrawio, prepareSelfHostedDrawio } from './index';

const SELF_HOSTED_URI = 'http://localhost:8080/?offline=1&https=0';
const BAKED_MATH_URL = 'https://viewer.diagrams.net/math4/es5';
const INSTANCE_MATH_URL = 'http://localhost:8080/math4/es5';

/** The location every MathJax boot went to, in order — nothing may boot it twice. */
let mathJaxBoots: string[] = [];

/**
 * Stand-in for the part of viewer-static.min.js the load-after entry point depends on: the
 * baked-in MathJax location is published, and Editor.initMath() — which acts only while
 * window.MathJax is undefined — writes the configuration draw.io derives from that location.
 *
 * Deliberately smaller than the stand-in in adopt-mathjax.spec.ts: what is checked here is
 * which of the two entry points acts at all, not where the startup script ends up.
 */
const evaluateViewerBundle = (): void => {
  const initMath = (): void => {
    if (typeof window.MathJax !== 'undefined') {
      return;
    }
    mathJaxBoots.push(window.DRAW_MATH_URL ?? '');
    window.MathJax = {
      loader: { paths: { fonts: `${window.DRAW_MATH_URL}/fonts` } },
    };
  };

  window.DRAW_MATH_URL ??= BAKED_MATH_URL;
  window.Editor = { initMath };
  initMath();
};

beforeEach(() => {
  mathJaxBoots = [];
  window.STENCIL_PATH = undefined;
  window.mxBasePath = undefined;
  window.DRAW_MATH_URL = undefined;
  window.MathJax = undefined;
  window.Editor = undefined;
});

describe('prepareSelfHostedDrawio', () => {
  it('should leave draw.io untouched when its own hosted viewer is configured', () => {
    prepareSelfHostedDrawio(`${DEFAULT_DRAWIO_ORIGIN}/`);

    expect(window.STENCIL_PATH).toBeUndefined();
    expect(window.MathJax).toBeUndefined();
  });

  it('should leave draw.io untouched when DRAWIO_URI holds nothing usable', () => {
    prepareSelfHostedDrawio('');

    expect(window.STENCIL_PATH).toBeUndefined();
    expect(window.MathJax).toBeUndefined();
  });

  it('should both rebase the asset paths and suppress the baked-in MathJax for a self-hosted instance', () => {
    prepareSelfHostedDrawio(SELF_HOSTED_URI);

    expect(window.STENCIL_PATH).toBeDefined();
    expect(window.MathJax).toBeDefined();
  });
});

describe('adoptSelfHostedDrawio', () => {
  it('should point MathJax at the configured instance', () => {
    // the state prepareSelfHostedDrawio and the bundle leave behind: the placeholder that
    // kept initMath() from booting MathJax from the baked-in location, and that location
    window.MathJax = {};
    evaluateViewerBundle();

    adoptSelfHostedDrawio(SELF_HOSTED_URI);

    expect(window.DRAW_MATH_URL).toBe(INSTANCE_MATH_URL);
    // the placeholder is gone: a leftover one would have kept initMath() from writing this
    expect(window.MathJax?.loader?.paths?.fonts).toBe(
      `${INSTANCE_MATH_URL}/fonts`,
    );
  });

  // The pre-state in the two tests below is the one the default configuration is supposed
  // to keep: no suppression was ever written, so the bundle booted MathJax from the
  // baked-in location by itself. Acting on that state would move DRAW_MATH_URL, throw away
  // the configuration draw.io wrote, and boot MathJax a second time — so all three
  // assertions fail if the self-hosted gate stops holding.
  it('should leave draw.io as the bundle left it when its own hosted viewer is configured', () => {
    evaluateViewerBundle();
    const bootedByDrawio = window.MathJax;

    adoptSelfHostedDrawio(`${DEFAULT_DRAWIO_ORIGIN}/`);

    expect(window.DRAW_MATH_URL).toBe(BAKED_MATH_URL);
    expect(mathJaxBoots).toEqual([BAKED_MATH_URL]);
    expect(window.MathJax).toBe(bootedByDrawio);
  });

  it('should leave draw.io as the bundle left it when DRAWIO_URI holds nothing usable', () => {
    evaluateViewerBundle();
    const bootedByDrawio = window.MathJax;

    adoptSelfHostedDrawio('');

    expect(window.DRAW_MATH_URL).toBe(BAKED_MATH_URL);
    expect(mathJaxBoots).toEqual([BAKED_MATH_URL]);
    expect(window.MathJax).toBe(bootedByDrawio);
  });
});

describe('the two entry points, in the order DrawioViewerScript runs them', () => {
  it('should leave the assets and MathJax on the configured instance, with no placeholder behind', () => {
    prepareSelfHostedDrawio(SELF_HOSTED_URI);
    evaluateViewerBundle();
    adoptSelfHostedDrawio(SELF_HOSTED_URI);

    // assets: through GROWI's own origin where the same-origin rule applies, straight from
    // the instance where it does not
    expect(window.STENCIL_PATH).toMatch(
      new RegExp(`^${DRAWIO_ASSET_PROXY_PATH}/`),
    );
    expect(window.mxBasePath).toBe('http://localhost:8080/mxgraph');

    // MathJax: booted from the instance, and no placeholder left for anything else on the
    // page to mistake for a MathJax that is present — the configuration below is draw.io's
    // own, which initMath() only writes once the placeholder is out of the way
    expect(window.DRAW_MATH_URL).toBe(INSTANCE_MATH_URL);
    expect(window.MathJax?.loader?.paths?.fonts).toBe(
      `${INSTANCE_MATH_URL}/fonts`,
    );
  });
});
