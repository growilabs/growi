// Layer membership and the dependency directions the design forbids
// (design.md "層の分け方の判断" 1-3 and the File Structure Plan).
// Paths are relative to the package root, without file extensions.

export type LayerName =
  | 'contract'
  | 'formats'
  | 'wire'
  | 'config'
  | 'conversion'
  | 'child'
  | 'runner'
  | 'http'
  | 'composition';

export type Layer = {
  readonly name: LayerName;
  readonly paths: readonly string[];
  readonly mayNotImport: readonly LayerName[];
};

const PARENT_ONLY: readonly LayerName[] = [
  'conversion',
  'child',
  'composition',
];
const CHILD_ONLY: readonly LayerName[] = ['runner', 'http', 'composition'];
const ABOVE_LEAVES: readonly LayerName[] = [
  'config',
  'conversion',
  'child',
  'runner',
  'http',
  'composition',
];

export const LAYERS: readonly Layer[] = [
  // Leaf layers: pure types / functions shared by parent and child (judgement 2).
  {
    name: 'contract',
    paths: ['src/contract'],
    mayNotImport: [...ABOVE_LEAVES, 'formats', 'wire'],
  },
  { name: 'formats', paths: ['src/formats'], mayNotImport: ABOVE_LEAVES },
  { name: 'wire', paths: ['src/wire'], mayNotImport: ABOVE_LEAVES },
  {
    name: 'config',
    paths: ['src/config'],
    mayNotImport: ['conversion', 'child', 'runner', 'http', 'composition'],
  },
  // Child-only code must not reach the parent's layers (judgement 1).
  { name: 'conversion', paths: ['src/conversion'], mayNotImport: CHILD_ONLY },
  { name: 'child', paths: ['src/child'], mayNotImport: CHILD_ONLY },
  // Parent-only code must not load child-only code (judgement 1); the runner
  // also stays below the HTTP layer.
  {
    name: 'runner',
    paths: ['src/runner'],
    mayNotImport: [...PARENT_ONLY, 'http'],
  },
  { name: 'http', paths: ['src/http'], mayNotImport: PARENT_ONLY },
  // Composition root and tooling wire several layers together (judgement 5).
  {
    name: 'composition',
    paths: ['src/service', 'src/main', 'scripts'],
    mayNotImport: [],
  },
];

export type PackageRule = {
  readonly packages: readonly string[];
  readonly onlyLayers: readonly LayerName[];
};

// Schema / OpenAPI packages belong to the HTTP layer alone (research 17.13, 27.8).
export const PACKAGE_RULES: readonly PackageRule[] = [
  { packages: ['zod', 'hono-openapi'], onlyLayers: ['http'] },
];

// Test files and test-support code import across layers on purpose.
export const isExcludedFromLayerCheck = (relativePath: string): boolean =>
  /\.(spec|integ)\.[cm]?[jt]sx?$/.test(relativePath) ||
  relativePath.split('/').includes('spec-support');
