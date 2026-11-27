import { renderMarkdownToTextHast } from '~/server/service/markdown-pipeline';

import {
  type RenderedTextWithSource,
  renderedTextWithSourceOf,
} from './rendered-text-source-map';

export interface RevisionBody {
  readonly id: string;
  readonly body: string;
}

/** Long enough for a burst of creates on one page, short enough to free the memory when idle. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  readonly revisionId: string;
  readonly rendered: Promise<RenderedTextWithSource>;
  readonly expiry: ReturnType<typeof setTimeout>;
}

// A single entry: creates arrive in bursts on one page, and a revision body
// never changes, so its id is a safe key.
let entry: CacheEntry | undefined;

const dropIfCurrent = (rendered: Promise<RenderedTextWithSource>): void => {
  if (entry?.rendered === rendered) {
    clearTimeout(entry.expiry);
    entry = undefined;
  }
};

/**
 * The rendered text of a revision, rendered at most once at a time per
 * revision: concurrent callers share the in-flight render, and the result is
 * kept for a short while. A failed render is not kept.
 */
export function renderedTextOfRevision(
  revision: RevisionBody,
): Promise<RenderedTextWithSource> {
  if (entry?.revisionId === revision.id) {
    return entry.rendered;
  }
  if (entry != null) {
    clearTimeout(entry.expiry);
  }

  const rendered = renderMarkdownToTextHast(revision.body).then((tree) =>
    renderedTextWithSourceOf(tree, revision.body),
  );
  const expiry = setTimeout(() => dropIfCurrent(rendered), CACHE_TTL_MS);
  // Never keep the process alive just to expire the entry.
  expiry.unref();
  entry = { revisionId: revision.id, rendered, expiry };
  rendered.catch(() => dropIfCurrent(rendered));
  return rendered;
}
