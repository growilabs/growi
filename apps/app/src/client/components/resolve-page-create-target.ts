import {
  getParentPath,
  normalizePath,
} from '@growi/core/dist/utils/path-utils';

type PageCreateTarget =
  | { readonly path: string; readonly parentPath: string }
  // Without `path`, the server generates an untitled page under `parentPath`
  | { readonly parentPath: string };

/**
 * Interpret the "Create under" input of PageCreateModal.
 * An empty input or one ending with '/' designates a parent path to create an untitled page under.
 */
export const resolvePageCreateTarget = (input: string): PageCreateTarget => {
  const trimmed = input.trim();

  if (trimmed === '' || trimmed.endsWith('/')) {
    return { parentPath: normalizePath(trimmed) };
  }

  const targetPath = normalizePath(trimmed);
  return { path: targetPath, parentPath: getParentPath(targetPath) };
};
