import type { YamlValue } from './yaml-parse';

// Narrowing accessors for parsed YAML. Each throws an error that names the path,
// so a test on a wrongly shaped file fails with a readable cause and needs no
// type assertion.

export type YamlObject = { readonly [key: string]: YamlValue };
export type PathSegment = string | number;

const describePath = (path: readonly PathSegment[]): string =>
  path.length === 0 ? '(root)' : path.join('.');

export const isObject = (value: YamlValue | undefined): value is YamlObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The value at `path`, or undefined when any step is missing.
export const valueAt = (
  root: YamlValue,
  ...path: readonly PathSegment[]
): YamlValue | undefined => {
  let current: YamlValue | undefined = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = isObject(current) ? current[segment] : undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
};

export const objectAt = (
  root: YamlValue,
  ...path: readonly PathSegment[]
): YamlObject => {
  const value = valueAt(root, ...path);
  if (!isObject(value)) {
    throw new Error(`expected a mapping at ${describePath(path)}`);
  }
  return value;
};

export const arrayAt = (
  root: YamlValue,
  ...path: readonly PathSegment[]
): readonly YamlValue[] => {
  const value = valueAt(root, ...path);
  if (!Array.isArray(value)) {
    throw new Error(`expected a sequence at ${describePath(path)}`);
  }
  return value;
};

export const stringAt = (
  root: YamlValue,
  ...path: readonly PathSegment[]
): string => {
  const value = valueAt(root, ...path);
  if (typeof value !== 'string') {
    throw new Error(`expected a string at ${describePath(path)}`);
  }
  return value;
};

// A sequence of strings (for example `cap_drop`, `tmpfs`).
export const stringsAt = (
  root: YamlValue,
  ...path: readonly PathSegment[]
): readonly string[] =>
  arrayAt(root, ...path).map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`expected a string at ${describePath([...path, index])}`);
    }
    return item;
  });
