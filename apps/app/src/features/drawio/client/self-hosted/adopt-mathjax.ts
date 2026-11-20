import urljoin from 'url-join';

import { relocateMathUrl } from './relocate-math-url';

import './drawio-globals';

/**
 * Keep draw.io from booting MathJax from the location baked into the bundle.
 *
 * Editor.initMath() runs at the very bottom of viewer-static.min.js and appends a
 * <script> for `DRAW_MATH_URL + '/startup.js'`. Taking that element back out afterwards
 * does not help: a dynamically inserted classic script runs once its fetch finishes,
 * whether or not it is still in the document. So when the baked-in location really is
 * reachable — https://viewer.diagrams.net/math4/es5 still is, which is what draw.io v29
 * and later bake in — MathJax boots a second time, the second boot leaves the first one
 * half-initialised, and typesetting dies with `Input Jax "tex" is not defined`. Nothing
 * renders, and only on machines that can reach the internet.
 *
 * initMath() does its work only while window.MathJax is undefined, so defining it here
 * turns the load-time call into a no-op and no script for the baked-in location is ever
 * appended. {@link adoptMathJax} then runs initMath() again with the location corrected.
 *
 * Must run BEFORE viewer-static.min.js evaluates. Writing it again is harmless.
 * refs: https://github.com/growilabs/growi/issues/9774
 */
export const suppressBakedMathJax = (): void => {
  window.MathJax ??= {};
};

/**
 * Boot MathJax from the configured instance instead.
 *
 * Run this after viewer-static.min.js has loaded and BEFORE the first diagram is
 * rendered: initMath() also installs the listeners that ask for typesetting, so a graph
 * built before this point would never be typeset.
 *
 * Setting DRAW_MATH_URL first matters beyond the startup script — draw.io's own MathJax
 * configuration derives `loader.paths.fonts` from it, so the font location comes out
 * right without being handled separately.
 *
 * When the baked-in value cannot be read there is nothing to relocate onto, so draw.io is
 * put back exactly as it would have been: the suppression is undone and initMath() runs
 * with draw.io's own location. Leaving the suppression in place instead would both break
 * math outright and leave a stray window.MathJax behind.
 */
export const adoptMathJax = (drawioUri: string): void => {
  const mathBaseUrl = relocateMathUrl(window.DRAW_MATH_URL, drawioUri);

  if (mathBaseUrl != null) {
    window.DRAW_MATH_URL = mathBaseUrl;
  }

  // re-arm the `typeof window.MathJax === 'undefined'` guard suppressBakedMathJax() tripped
  window.MathJax = undefined;

  window.Editor?.initMath?.(
    mathBaseUrl == null ? undefined : urljoin(mathBaseUrl, 'startup.js'),
  );
};
