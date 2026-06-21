import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { GrowiPluginPackageData } from '../../../../model';

export const importPackageJson = (
  projectDirRoot: string,
): GrowiPluginPackageData => {
  const packageJsonUrl = path.resolve(projectDirRoot, 'package.json');
  return JSON.parse(readFileSync(packageJsonUrl, 'utf-8'));
};
