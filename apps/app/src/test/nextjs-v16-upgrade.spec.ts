import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = path.resolve(__dirname, '../..');

describe('Next.js v16 Upgrade', () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(appDir, 'package.json'), 'utf-8'),
  );

  describe('dependency versions', () => {
    it('should have next ^16.0.0', () => {
      expect(packageJson.dependencies.next).toBe('^16.0.0');
    });

    it('should have @next/bundle-analyzer ^16.0.0', () => {
      expect(packageJson.devDependencies['@next/bundle-analyzer']).toBe(
        '^16.0.0',
      );
    });

    it('should keep react at ^18.2.0', () => {
      expect(packageJson.dependencies.react).toBe('^18.2.0');
    });

    it('should keep react-dom at ^18.2.0', () => {
      expect(packageJson.dependencies['react-dom']).toBe('^18.2.0');
    });
  });

  describe('build scripts', () => {
    it('should include --webpack flag in build:client', () => {
      expect(packageJson.scripts['build:client']).toBe('next build --webpack');
    });

    it('should not change start script (no bundler at runtime)', () => {
      expect(packageJson.scripts.start).toBe('next start');
    });
  });

  describe('Sass tilde imports', () => {
    it('should not use tilde prefix for node_modules imports in toastr.scss', () => {
      const toastrScss = readFileSync(
        path.join(appDir, 'src/styles/molecules/toastr.scss'),
        'utf-8',
      );
      // Should not have ~react-toastify (node_modules tilde)
      expect(toastrScss).not.toMatch(/@import\s+['"]~react-toastify/);
      // Should have the import without tilde
      expect(toastrScss).toMatch(
        /@import\s+['"]react-toastify\/scss\/main['"]/,
      );
    });
  });

  describe('measurement script', () => {
    it('should use --webpack flag in next dev command', () => {
      const script = readFileSync(
        path.join(appDir, 'bin/measure-chunk-stats.sh'),
        'utf-8',
      );
      expect(script).toContain('next dev');
      expect(script).toMatch(/next dev\b.*--webpack/);
    });

    it('should clean .next/dev directory for v16 isolated dev builds', () => {
      const script = readFileSync(
        path.join(appDir, 'bin/measure-chunk-stats.sh'),
        'utf-8',
      );
      expect(script).toContain('.next/dev');
    });
  });

  describe('custom server webpack option', () => {
    it('should pass webpack: true to next() in the custom server', () => {
      const crowiIndex = readFileSync(
        path.join(appDir, 'src/server/crowi/index.ts'),
        'utf-8',
      );
      // The programmatic API should use webpack: true to opt out of Turbopack
      expect(crowiIndex).toMatch(/next\(\{[^}]*webpack:\s*true/);
    });
  });

  describe('next.config.ts webpack function', () => {
    it('should have a webpack function defined', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toMatch(/webpack\(config,\s*options\)/);
    });

    it('should have all 7 null-loader rules', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      const nullLoaderPackages = [
        'dtrace-provider',
        'mongoose',
        'mathjax-full',
        'i18next-fs-backend',
        'bunyan',
        'bunyan-format',
        'core-js',
      ];
      for (const pkg of nullLoaderPackages) {
        expect(config).toContain(pkg);
      }
      expect(config).toContain("use: 'null-loader'");
    });

    it('should have superjson-ssr-loader', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('superjson-ssr-loader');
    });

    it('should have I18NextHMRPlugin', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('I18NextHMRPlugin');
    });

    it('should have ChunkModuleStatsPlugin', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('createChunkModuleStatsPlugin');
    });

    it('should have source-map-loader', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('source-map-loader');
    });

    it('should have bundlePagesRouterDependencies enabled', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('bundlePagesRouterDependencies: true');
    });

    it('should have optimizePackageImports configured', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('optimizePackageImports');
    });

    it('should have transpilePackages configured', () => {
      const config = readFileSync(path.join(appDir, 'next.config.ts'), 'utf-8');
      expect(config).toContain('transpilePackages');
    });
  });
});
