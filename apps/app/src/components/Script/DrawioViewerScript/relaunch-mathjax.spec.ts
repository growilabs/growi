// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableJavaScriptFileLoading": true } }

import { relaunchMathJax } from './relaunch-mathjax';

const BAKED = 'https://viewer.diagrams.net/math/es5';
const LOCAL = 'http://localhost:8080/math/es5';

const appendBakedScript = (): HTMLScriptElement => {
  const script = document.createElement('script');
  script.src = `${BAKED}/startup.js`;
  document.head.appendChild(script);
  return script;
};

const startupSrcs = (): string[] =>
  Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map(
    (el) => el.src,
  );

describe('relaunchMathJax', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    window.DRAW_MATH_URL = BAKED;
    window.MathJax = {
      loader: { paths: { fonts: `${BAKED}/fonts` } },
    };
  });

  it('should load MathJax startup from the given base url', () => {
    appendBakedScript();

    relaunchMathJax(BAKED, LOCAL);

    expect(startupSrcs()).toContain(`${LOCAL}/startup.js`);
  });

  it('should drop the startup script that points at the unreachable location', () => {
    appendBakedScript();

    relaunchMathJax(BAKED, LOCAL);

    expect(startupSrcs()).not.toContain(`${BAKED}/startup.js`);
  });

  it('should repoint DRAW_MATH_URL so later reads resolve to the instance', () => {
    relaunchMathJax(BAKED, LOCAL);

    expect(window.DRAW_MATH_URL).toBe(LOCAL);
  });

  it('should repoint the font path MathJax was configured with', () => {
    relaunchMathJax(BAKED, LOCAL);

    expect(window.MathJax?.loader?.paths?.fonts).toBe(`${LOCAL}/fonts`);
  });

  it('should not load startup twice when called again', () => {
    relaunchMathJax(BAKED, LOCAL);
    relaunchMathJax(BAKED, LOCAL);

    expect(
      startupSrcs().filter((src) => src === `${LOCAL}/startup.js`),
    ).toHaveLength(1);
  });

  it('should still load startup when MathJax has no font path to fix', () => {
    window.MathJax = undefined;

    expect(() => relaunchMathJax(BAKED, LOCAL)).not.toThrow();
    expect(startupSrcs()).toContain(`${LOCAL}/startup.js`);
  });
});
