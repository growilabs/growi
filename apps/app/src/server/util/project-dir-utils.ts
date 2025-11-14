import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isServer } from '@growi/core/dist/utils/browser-utils';

const isCurrentDirRoot = isServer() && fs.existsSync('./next.config.js');

export const projectRoot = isCurrentDirRoot
  ? process.cwd()
  : path.resolve(__dirname, '../../');

export function resolveFromRoot(relativePath: string): string {
  return path.resolve(projectRoot, relativePath);
}
