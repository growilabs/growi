import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findViolations, type SourceFile } from './find-violations';
import { LAYERS, PACKAGE_RULES } from './layer-rules';

const PACKAGE_ROOT = path.resolve(__dirname, '../..');

const listSourceFiles = (dir: string): SourceFile[] =>
  readdirSync(path.join(PACKAGE_ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return listSourceFiles(relative);
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      return [
        {
          path: relative,
          source: readFileSync(path.join(PACKAGE_ROOT, relative), 'utf8'),
        },
      ];
    },
  );

const check = (files: readonly SourceFile[]) =>
  findViolations(files, LAYERS, PACKAGE_RULES);

describe('layer dependency direction', () => {
  it('has no forbidden import in src/ and scripts/', () => {
    const files = [...listSourceFiles('src'), ...listSourceFiles('scripts')];

    expect(files.length).toBeGreaterThan(50);
    expect(check(files)).toEqual([]);
  });

  describe('detection (synthetic sources)', () => {
    it.each([
      [
        'conversion',
        'src/conversion/a.ts',
        "import { x } from '../http';",
        'conversion must not import http',
      ],
      [
        'conversion',
        'src/conversion/ooxml/a.ts',
        "import type { x } from '../../runner/run-outcome';",
        'conversion must not import runner',
      ],
      [
        'child',
        'src/child/a.ts',
        "import { x } from '../http/create-app';",
        'child must not import http',
      ],
      [
        'runner',
        'src/runner/a.ts',
        "const m = await import('../conversion');",
        'runner must not import conversion',
      ],
      [
        'runner',
        'src/runner/a.ts',
        "import { x } from '../http';",
        'runner must not import http',
      ],
      [
        'runner',
        'src/runner/a.ts',
        "import { x } from '../child/child-entry';",
        'runner must not import child',
      ],
      [
        'http',
        'src/http/a.ts',
        "import { convert } from '../conversion';",
        'http must not import conversion',
      ],
      [
        'formats',
        'src/formats/a.ts',
        "import { x } from '../runner';",
        'formats must not import runner',
      ],
      [
        'config',
        'src/config/a.ts',
        "import '../conversion';",
        'config must not import conversion',
      ],
      [
        'child',
        'src/child/a.ts',
        "import '../service';",
        'child must not import composition',
      ],
      [
        'runner',
        'src/runner/a.ts',
        'export const f = () => import(`../conversion`);',
        'runner must not import conversion',
      ],
    ])('rejects %s importing a forbidden layer: %s', (_layer, file, source, reason) => {
      expect(check([{ path: file, source }]).map((v) => v.reason)).toEqual([
        reason,
      ]);
    });

    it('accepts the allowed directions', () => {
      const files: SourceFile[] = [
        {
          path: 'src/http/a.ts',
          source:
            "import type { R } from '../runner';\nimport { C } from '../contract';",
        },
        {
          path: 'src/runner/a.ts',
          source:
            "import { f } from '../formats/input-size';\nimport { w } from '../wire/x';",
        },
        {
          path: 'src/child/a.ts',
          source: "import { convert } from '../conversion';",
        },
        {
          path: 'src/service.ts',
          source:
            "import { createApp } from './http';\nimport { r } from './runner';",
        },
        {
          path: 'scripts/a.ts',
          source: "import { createApp } from '../src/http';",
        },
      ];

      expect(check(files)).toEqual([]);
    });

    it('allows zod and hono-openapi only in the http layer', () => {
      const sources =
        "import { z } from 'zod';\nconst d = await import('hono-openapi');";

      expect(check([{ path: 'src/http/a.ts', source: sources }])).toEqual([]);
      expect(
        check([{ path: 'src/conversion/a.ts', source: sources }]).map(
          (v) => v.specifier,
        ),
      ).toEqual(['zod', 'hono-openapi']);
      expect(check([{ path: 'src/main.ts', source: sources }])).toHaveLength(2);
    });

    it('skips test files and test-support code', () => {
      const source = "import { x } from '../runner/conversion-runner';";
      const files: SourceFile[] = [
        { path: 'src/http/a.spec.ts', source },
        { path: 'src/http/b.integ.ts', source },
        {
          path: 'src/http/spec-support/fake-runner.ts',
          source: "import { x } from '../../conversion';",
        },
      ];

      expect(check(files)).toEqual([]);
    });

    it('reports a file that belongs to no declared layer', () => {
      expect(
        check([{ path: 'src/newlayer/a.ts', source: '' }]).map((v) => v.reason),
      ).toEqual(['file belongs to no declared layer']);
    });
  });
});
