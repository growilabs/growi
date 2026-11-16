import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type DockerfileModel, parseDockerfile } from './dockerfile-model';

// Where the deployment files of the service live (design.md D4, research.md
// 23.7). The specs read these fixed paths.

export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const REPO_ROOT = resolve(PACKAGE_DIR, '../..');

export const DOCKERFILE_PATH = resolve(PACKAGE_DIR, 'docker/Dockerfile');
export const PACKAGE_JSON_PATH = resolve(PACKAGE_DIR, 'package.json');

// A missing file fails the test that reads it (never a skip), with the path.
export const readDeployFile = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`${relative(REPO_ROOT, path)} does not exist`);
    }
    throw error;
  }
};

export const loadDockerfile = (): DockerfileModel =>
  parseDockerfile(readDeployFile(DOCKERFILE_PATH));

export interface PackageManifest {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
}

const stringRecord = (
  value: unknown,
  field: string,
): Record<string, string> => {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`package.json: "${field}" must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`package.json: "${field}.${key}" must be a string`);
    }
    result[key] = item;
  }
  return result;
};

export const loadPackageManifest = (): PackageManifest => {
  const parsed: unknown = JSON.parse(readDeployFile(PACKAGE_JSON_PATH));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('package.json must hold an object');
  }
  const field = (name: string): unknown => Reflect.get(parsed, name);
  return {
    dependencies: stringRecord(field('dependencies'), 'dependencies'),
    devDependencies: stringRecord(field('devDependencies'), 'devDependencies'),
    scripts: stringRecord(field('scripts'), 'scripts'),
  };
};
