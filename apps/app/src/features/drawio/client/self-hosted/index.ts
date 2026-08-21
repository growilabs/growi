import { isSelfHostedDrawio } from '../../is-self-hosted-drawio';
import { adoptMathJax, suppressBakedMathJax } from './adopt-mathjax';
import { rebaseDrawioAssetPaths } from './rebase-asset-paths';

export { isSelfHostedDrawio };

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
