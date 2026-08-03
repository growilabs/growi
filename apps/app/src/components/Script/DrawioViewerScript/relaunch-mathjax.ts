import urljoin from 'url-join';

// The subset of MathJax's configuration object that draw.io fills in and we have to
// correct. Once MathJax boots it replaces this global with its own API object.
type MathJaxConfig = {
  loader?: { paths?: Record<string, string> };
};

declare global {
  var DRAW_MATH_URL: string | undefined;
  var MathJax: MathJaxConfig | undefined;
}

const startupUrl = (mathBaseUrl: string): string =>
  urljoin(mathBaseUrl, 'startup.js');

// Editor.initMath() has already run by the time this is called: it built the MathJax
// configuration around the baked-in location and appended a startup script for it. Point
// both at the configured instance and load startup again from there.
// refs: https://github.com/growilabs/growi/issues/9774
export const relaunchMathJax = (
  bakedMathUrl: string,
  mathBaseUrl: string,
): void => {
  const src = startupUrl(mathBaseUrl);

  if (document.querySelector(`script[src="${src}"]`) != null) {
    return;
  }

  // Best effort: the request may already be in flight, in which case MathJax simply boots
  // once and the surviving configuration below decides where its components come from.
  document.querySelector(`script[src="${startupUrl(bakedMathUrl)}"]`)?.remove();

  window.DRAW_MATH_URL = mathBaseUrl;

  const paths = window.MathJax?.loader?.paths;
  if (paths?.fonts != null) {
    paths.fonts = urljoin(mathBaseUrl, 'fonts');
  }

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = src;
  document.head.appendChild(script);
};
