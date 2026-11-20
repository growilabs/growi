import path from 'node:path';

/**
 * Compute an `href` / `src` that points from an exported page's HTML file to
 * another file in the job's output dir. A page at `html/{jobId}/a/b.html`
 * reaches `html/{jobId}/x.css` as `../x.css`. Path segments are URL-encoded so
 * the reference stays valid for any page path.
 */
export function toRelativeHref(
  pageFilePath: string,
  targetFilePath: string,
): string {
  const relativePath = path.relative(
    path.dirname(pageFilePath),
    targetFilePath,
  );
  return relativePath.split(path.sep).map(encodeURIComponent).join('/');
}
