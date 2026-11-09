// Python's posixpath, which node:path.posix does not match: normalize('')
// is '.', normalize() keeps a trailing '/', and it folds a leading '//'.

export const basename = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1);

export const dirname = (path: string): string => {
  const head = path.slice(0, path.lastIndexOf('/') + 1);
  return /^\/*$/.test(head) ? head : head.replace(/\/+$/, '');
};

export const join = (first: string, ...rest: readonly string[]): string =>
  rest.reduce((path, part) => {
    if (part.startsWith('/')) return part;
    return path === '' || path.endsWith('/') ? path + part : `${path}/${part}`;
  }, first);

export const normpath = (path: string): string => {
  if (path === '') {
    return '.';
  }
  const leading =
    path.startsWith('//') && !path.startsWith('///')
      ? 2
      : path.startsWith('/')
        ? 1
        : 0;
  const kept: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (
      segment !== '..' ||
      (leading === 0 && kept.length === 0) ||
      kept.at(-1) === '..'
    ) {
      kept.push(segment);
    } else if (kept.length > 0) {
      kept.pop();
    }
  }
  return '/'.repeat(leading) + kept.join('/') || '.';
};
