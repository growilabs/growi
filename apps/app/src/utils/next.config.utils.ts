// workaround by https://github.com/martpie/next-transpile-modules/issues/143#issuecomment-817467144

import fs from 'node:fs';
import path from 'node:path';

const nodeModulesPaths = [
  path.resolve(__dirname, '../../node_modules'),
  path.resolve(__dirname, '../../../../node_modules'),
];

interface Opts {
  ignorePackageNames: string[];
}

const defaultOpts: Opts = { ignorePackageNames: [] };

export const listPrefixedPackages = (
  prefixes: string[],
  opts: Opts = defaultOpts,
): string[] => {
  const prefixedPackages: string[] = [];

  nodeModulesPaths.forEach((nodeModulesPath) => {
    fs.readdirSync(nodeModulesPath)
      .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
      .filter((name) => !name.startsWith('.'))
      .forEach((folderName) => {
        const packageJsonPath = path.resolve(
          nodeModulesPath,
          folderName,
          'package.json',
        );
        if (fs.existsSync(packageJsonPath)) {
          const { name } = JSON.parse(
            fs.readFileSync(packageJsonPath, 'utf-8'),
          ) as { name: string };
          if (!opts.ignorePackageNames.includes(name)) {
            prefixedPackages.push(name);
          }
        }
      });
  });

  return prefixedPackages;
};
