import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type DockerfileModel, parseDockerfile } from './dockerfile-model';
import { parseYaml, type YamlValue } from './yaml-parse';

// Where the deployment files of the Node service live (design.md D4, research.md
// 23.7). The specs read these fixed paths, never the Python service's files.

export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const REPO_ROOT = resolve(PACKAGE_DIR, '../..');

export const DOCKERFILE_PATH = resolve(PACKAGE_DIR, 'docker/Dockerfile');
export const COMPOSE_PATH = resolve(REPO_ROOT, 'infra/docker/compose.yaml');
export const PACKAGE_JSON_PATH = resolve(PACKAGE_DIR, 'package.json');

export const COMPOSE_SERVICE = 'attachment-text-extractor';

// A missing file fails the test that reads it (never a skip), with the path.
export const readDeployFile = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `${relative(REPO_ROOT, path)} does not exist (the Node deployment file has not been created yet)`,
      );
    }
    throw error;
  }
};

export const loadDockerfile = (): DockerfileModel =>
  parseDockerfile(readDeployFile(DOCKERFILE_PATH));

export const loadYamlFile = (path: string): YamlValue =>
  parseYaml(readDeployFile(path));

const MIB_PER_UNIT: Readonly<Record<string, number>> = {
  '': 1 / (1024 * 1024),
  b: 1 / (1024 * 1024),
  k: 1 / 1024,
  m: 1,
  g: 1024,
};

// Docker parses a size such as `64m` or `2g` (bytes, k, m, g) into MiB.
export const sizeToMiB = (size: string | number): number => {
  const match = /^(\d+)([bkmg]?)b?$/i.exec(String(size).trim());
  if (match === null) throw new Error(`unreadable size: ${size}`);
  return Number(match[1]) * MIB_PER_UNIT[match[2].toLowerCase()];
};

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
