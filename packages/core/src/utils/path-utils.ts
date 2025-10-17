interface PathParts {
  readonly headingSlashes: string;
  readonly content: string;
  readonly trailingSlashes: string;
  readonly hasHeadingSlash: boolean;
  readonly hasTrailingSlash: boolean;
}

function parsePath(path: string): PathParts | null {
  if (typeof path !== 'string' || !path || path === '') return null;

  // Special case for root path
  if (path === '/') {
    return {
      headingSlashes: '/',
      content: '',
      trailingSlashes: '',
      hasHeadingSlash: true,
      hasTrailingSlash: true,
    };
  }

  let startIndex = 0;
  let endIndex = path.length;

  // Find leading slashes
  while (startIndex < path.length && path[startIndex] === '/') {
    startIndex++;
  }

  // Find trailing slashes
  while (endIndex > startIndex && path[endIndex - 1] === '/') {
    endIndex--;
  }

  const headingSlashes = path.substring(0, startIndex);
  const content = path.substring(startIndex, endIndex);
  const trailingSlashes = path.substring(endIndex);

  return {
    headingSlashes,
    content,
    trailingSlashes,
    hasHeadingSlash: headingSlashes.length > 0,
    hasTrailingSlash: trailingSlashes.length > 0,
  };
}

export function hasHeadingSlash(path: string): boolean {
  if (path === '/') return true;

  const parts = parsePath(path);
  return parts?.hasHeadingSlash ?? false;
}

export function hasTrailingSlash(path: string): boolean {
  if (path === '/') return true;

  const parts = parsePath(path);
  return parts?.hasTrailingSlash ?? false;
}

export function addHeadingSlash(path: string): string {
  if (path === '/') return path;
  if (path === '') return '/';

  const parts = parsePath(path);
  if (!parts?.hasHeadingSlash) {
    return `/${path}`;
  }
  return path;
}

export function addTrailingSlash(path: string): string {
  if (path === '/') return path;
  if (path === '') return '/';

  const parts = parsePath(path);
  if (!parts?.hasTrailingSlash) {
    return `${path}/`;
  }
  return path;
}

export function removeHeadingSlash(path: string): string {
  if (path === '/') return path;
  if (path === '') return path;

  const parts = parsePath(path);
  if (!parts?.hasHeadingSlash) return path;

  // Special case for '//' -> '/'
  if (path === '//') return '/';

  // Remove heading slashes and return content + trailing slashes
  return parts.content + parts.trailingSlashes;
}

export function removeTrailingSlash(path: string): string {
  if (path === '/') return path;
  if (path === '') return path;

  const parts = parsePath(path);
  if (parts == null) return path;

  // Return heading slashes + content (without trailing slashes)
  return parts.headingSlashes + parts.content;
}

/**
 * A short-hand method to add heading slash and remove trailing slash.
 */
export function normalizePath(path: string): string {
  if (typeof path !== 'string' || path === '' || path === '/') {
    return '/';
  }

  const parts = parsePath(path);
  if (parts == null) {
    return '/';
  }
  return `/${parts.content}`;
}

export function attachTitleHeader(path: string): string {
  return `# ${path}`;
}

/**
 * If the pagePath is top page path, eliminate the pageId from the url path.
 */
export function returnPathForURL(path: string, id: string): string {
  if (path === '/') {
    return path;
  }

  return addHeadingSlash(id);
}

/**
 * Get the parent path of the specified path.
 */
export function getParentPath(path: string): string {
  return normalizePath(path.split('/').slice(0, -1).join('/'));
}
