import path from 'node:path';

import { extractImportSpecifiers } from './import-specifiers';
import {
  isExcludedFromLayerCheck,
  type Layer,
  type LayerName,
  type PackageRule,
} from './layer-rules';

export type SourceFile = { readonly path: string; readonly source: string };

export type Violation = {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
};

const stripExtension = (p: string): string => p.replace(/\.[cm]?[jt]sx?$/, '');

const layerOf = (
  filePath: string,
  layers: readonly Layer[],
): LayerName | undefined => {
  const target = stripExtension(filePath);
  return layers.find((layer) =>
    layer.paths.some((p) => target === p || target.startsWith(`${p}/`)),
  )?.name;
};

const packageNameOf = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

export const findViolations = (
  files: readonly SourceFile[],
  layers: readonly Layer[],
  packageRules: readonly PackageRule[],
): readonly Violation[] => {
  const violations: Violation[] = [];
  for (const file of files) {
    if (isExcludedFromLayerCheck(file.path)) continue;
    const own = layerOf(file.path, layers);
    if (own == null) {
      violations.push({
        file: file.path,
        specifier: '',
        reason: 'file belongs to no declared layer',
      });
      continue;
    }
    const forbidden = layers.find((l) => l.name === own)?.mayNotImport ?? [];
    for (const specifier of extractImportSpecifiers(file.source)) {
      if (specifier.startsWith('.')) {
        const target = path.posix.join(
          path.posix.dirname(file.path),
          specifier,
        );
        const targetLayer = layerOf(target, layers);
        if (targetLayer != null && forbidden.includes(targetLayer)) {
          violations.push({
            file: file.path,
            specifier,
            reason: `${own} must not import ${targetLayer}`,
          });
        }
        continue;
      }
      const pkg = packageNameOf(specifier);
      for (const rule of packageRules) {
        if (rule.packages.includes(pkg) && !rule.onlyLayers.includes(own)) {
          violations.push({
            file: file.path,
            specifier,
            reason: `${pkg} may only be imported by ${rule.onlyLayers.join(', ')}, not ${own}`,
          });
        }
      }
    }
  }
  return violations;
};
