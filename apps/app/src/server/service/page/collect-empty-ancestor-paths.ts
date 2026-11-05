import pathlib from 'path';

/**
 * Paths of the empty pages a rename to under itself must insert: every ancestor of
 * `toPath` down to and including `fromPath`, nearest ancestor first.
 */
export const collectEmptyAncestorPaths = (
  fromPath: string,
  toPath: string,
): string[] => {
  const paths: string[] = [];
  let path = toPath;
  while (path !== fromPath) {
    const parentPath = pathlib.dirname(path);
    // `dirname('/')` is '/': without this the walk never ends when toPath is not under fromPath
    if (parentPath === path) {
      throw new Error(`"${toPath}" is not under "${fromPath}"`);
    }
    path = parentPath;
    paths.push(path);
  }
  return paths;
};
