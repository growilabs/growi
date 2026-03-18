import path from 'node:path';
import process from 'node:process';

export const projectRoot = process.cwd();

export function resolveFromRoot(relativePath: string): string {
  return path.resolve(projectRoot, relativePath);
}
