import nodePath from 'node:path';

// GROWI pages have no separate title field, so the last path segment is the
// display title (the whole path for the root "/"). Shared so search results and
// URL previews cannot drift apart.
export const titleFromPath = (path: string): string =>
  nodePath.basename(path) || path;
