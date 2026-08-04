import { DEFAULT_DRAWIO_ORIGIN } from '../../consts';
import { adoptMathJax, suppressBakedMathJax } from './adopt-mathjax';
import { rebaseDrawioAssetPaths } from './rebase-asset-paths';

/**
 * Whether DRAWIO_URI points at something other than draw.io's own hosted viewer.
 *
 * An unparsable value counts as not self-hosted: there is nothing to rebase onto, and
 * leaving draw.io's own defaults in place is the better failure.
 */
export const isSelfHostedDrawio = (drawioUri: string): boolean => {
  try {
    return new URL(drawioUri).origin !== DEFAULT_DRAWIO_ORIGIN;
  } catch {
    return false;
  }
};

/**
 * Everything that has to be in place BEFORE viewer-static.min.js is inserted.
 *
 * Both halves work by writing globals the bundle reads while it evaluates, so there is no
 * later point at which they could be applied. Safe to call during server rendering and on
 * every client render.
 */
export const prepareSelfHostedDrawio = (drawioUri: string): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (!isSelfHostedDrawio(drawioUri)) {
    return;
  }

  rebaseDrawioAssetPaths(drawioUri);
  suppressBakedMathJax();
};

/**
 * Everything that has to happen AFTER viewer-static.min.js has loaded, and before the
 * first diagram is rendered.
 */
export const adoptSelfHostedDrawio = (drawioUri: string): void => {
  if (!isSelfHostedDrawio(drawioUri)) {
    return;
  }

  adoptMathJax(drawioUri);
};
