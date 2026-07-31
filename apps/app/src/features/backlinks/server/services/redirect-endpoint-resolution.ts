import PageRedirect from '~/server/models/page-redirect';

type RedirectHop = {
  fromPath: string;
  toPath: string;
  depth: number;
};

type RedirectWithChains = {
  fromPath: string;
  toPath: string;
  chains: RedirectHop[];
};

/**
 * Batch equivalent of `PageRedirect.retrievePageRedirectEndpoints`, used by link
 * resolution to follow a rename when a stored `toPath` has no live page.
 *
 * Why a batch variant rather than calling the model static per path: a single
 * page can carry many links whose paths resolve to nothing — renamed targets,
 * but also the common wiki habit of linking to not-yet-created pages — and every
 * save re-resolves all of them. Matching with `$in` keeps that at one
 * aggregation regardless of how many paths missed.
 *
 * `fromPath` is unique-indexed, so at most one document matches per input path;
 * unlike the single-path static there is no ambiguity to warn about.
 *
 * @param fromPaths - Paths that found no live page.
 * @returns Map from the input path to the final path of its redirect chain.
 *          Paths with no redirect document are absent from the map.
 */
export const resolveRedirectEndpoints = async (
  fromPaths: string[],
): Promise<Map<string, string>> => {
  if (fromPaths.length === 0) return new Map();

  const redirects = await PageRedirect.aggregate<RedirectWithChains>([
    { $match: { fromPath: { $in: fromPaths } } },
    {
      $graphLookup: {
        from: 'pageredirects',
        startWith: '$toPath',
        connectFromField: 'toPath',
        connectToField: 'fromPath',
        as: 'chains',
        depthField: 'depth',
      },
    },
  ]);

  const result = new Map<string, string>();

  for (const redirect of redirects) {
    // `chains` is unordered, so the end of a multi-rename chain (A->B->C) is the
    // deepest hop. $graphLookup visits each document once, so a redirect cycle
    // terminates here and yields a path that simply has no page — reported as
    // unresolved by the caller.
    const deepest = redirect.chains.reduce<RedirectHop | null>(
      (acc, hop) => (acc == null || hop.depth > acc.depth ? hop : acc),
      null,
    );
    result.set(redirect.fromPath, deepest?.toPath ?? redirect.toPath);
  }

  return result;
};
