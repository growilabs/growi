import { DEFAULT_DRAWIO_ORIGIN } from './consts';

/**
 * Whether DRAWIO_URI points at something other than draw.io's own hosted viewer.
 *
 * Shared by both halves of this feature on purpose: the client only rebases asset paths
 * when this holds, so the server route has to answer the same question the same way or it
 * would serve requests nothing ever makes.
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
