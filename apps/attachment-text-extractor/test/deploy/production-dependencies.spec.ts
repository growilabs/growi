import { loadPackageManifest } from './deploy-files';

// The production dependencies are exactly the nine adopted libraries
// (research.md 21.2). Anything else in `dependencies` ends up in the image through
// `pnpm deploy --prod`, so a new entry must be a deliberate change to this list.
// This maps Python's test_dependencies.py "production dependencies exclude external
// binary and removed libraries" (research.md 22.3): the exact list also keeps out
// every rejected library (OCR, external-command wrappers, other PDF and HTML
// parsers, the test-only tools). Requirement 8.3.

const ALLOWED_PRODUCTION_DEPENDENCIES = [
  '@embedpdf/pdfium',
  '@firecrawl/anydoc',
  '@hono/node-server',
  '@xmldom/xmldom',
  'entities',
  'hono',
  'htmlparser2',
  'yauzl',
  'yazl',
] as const;

describe('production dependencies', () => {
  it('are exactly the nine adopted libraries', () => {
    expect(Object.keys(loadPackageManifest().dependencies).sort()).toEqual([
      ...ALLOWED_PRODUCTION_DEPENDENCIES,
    ]);
  });

  it('keep test-only tools, type definitions and the build toolchain out of dependencies', () => {
    const { dependencies, devDependencies } = loadPackageManifest();
    for (const name of Object.keys(dependencies)) {
      expect(name).not.toMatch(/^@types\//);
      expect(name).not.toMatch(/^(vitest|@swc|@swc-node|playwright|ajv)/);
      expect(Object.keys(devDependencies), name).not.toContain(name);
    }
  });

  it('pin anydoc, the PDFium WASM and htmlparser2 to exact versions (research.md 21.3)', () => {
    const { dependencies } = loadPackageManifest();
    expect(dependencies['@firecrawl/anydoc']).toBe('=0.2.4');
    expect(dependencies['@embedpdf/pdfium']).toMatch(/^=\d+\.\d+\.\d+$/);
    expect(dependencies.htmlparser2).toMatch(/^=\d+\.\d+\.\d+$/);
  });

  it('run no install-time script of their own (the image installs with the deployed lockfile only)', () => {
    const { scripts } = loadPackageManifest();
    for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(Object.keys(scripts), name).not.toContain(name);
    }
  });
});
