/* eslint-disable import/prefer-default-export */

import { isServer } from '@growi/core/dist/utils/browser-utils';
import fs from 'fs';
import path from 'path';
import process from 'process';

const isCurrentDirRoot = isServer() && fs.existsSync('./next.config.js');

export const projectRoot = isCurrentDirRoot
  ? process.cwd()
  : path.resolve(__dirname, '../../');

export function resolveFromRoot(relativePath: string): string {
  return path.resolve(projectRoot, relativePath);
}
