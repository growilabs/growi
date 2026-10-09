// Architecture boundary guards for the whole app (design.md "Allowed Dependencies" /
// "依存の向き"). This file deliberately lives at the top of `src/` rather than inside one
// layer's directory: it spans every layer, and burying it in one of them would suggest it
// only guards that layer.
//
// Two independent guards, because one does not imply the other:
//   1. layer order   — a file may only import its own layer or a layer to its LEFT.
//   2. Chat SDK origin — `chat` / `@chat-adapter/*` / `chat-adapter-mattermost` may only be
//      imported from `src/platform/**`. The Chat SDK is not a layer, so a file that is
//      perfectly layer-order-correct (e.g. `orchestration/`, near the right end of the
//      chain) can still import it directly without breaking guard 1.
//   3. Prisma generated-client origin — `src/generated/**` may only be imported from
//      `src/db/**`. Added by task 2.1, which needed the first import of the generated client:
//      like the Chat SDK, `generated/` is not a layer (it is not hand-written source), so
//      guard 1 cannot express "legal from exactly one place" for it and would instead reject
//      every importer including the legal one. Guard 1 therefore skips resolved paths under
//      `generated/` and this guard takes over. Note this must stay a path-based rule and must
//      never be relaxed into a tsconfig path alias: guard 1 only inspects specifiers starting
//      with `.`, so a non-relative alias would slip past both guards silently.
//   4. db barrel-only — a file outside `src/db/**` may reach the storage layer only through
//      its declared barrels (`src/db/index.ts` or `src/db/repositories/index.ts`, both named
//      as public entry points in design.md's File Structure Plan), never by importing
//      `src/db/repositories/*.ts` or `src/db/prisma-client.ts` directly. Added by task 2.3,
//      which is exactly the task that created
//      created `db/index.ts` and `db/repositories/index.ts`: guard 1 already keeps every OTHER
//      layer from importing `db/` out of order, but it has nothing to say about which FILE
//      inside `db/` a caller reaches, because from guard 1's point of view every file under
//      `db/` is equally "the db layer". This guard is narrower than guard 1 and independent of
//      it, the same way guard 3 is independent of guard 1 for `generated/`.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * design.md: 「**依存の向き**（左のものだけを import してよい）:
 * types → capabilities → db → platform → command → relation → growi → orchestration → routes」
 *
 * A file may import from its own layer (barrels re-export their siblings) or from any layer
 * to its left. `types/` being reachable from everywhere is a consequence of it being the
 * leftmost entry, not a separate exemption.
 */
const LAYER_ORDER = [
  'types',
  'capabilities',
  'db',
  'platform',
  'command',
  'relation',
  'growi',
  'orchestration',
  'routes',
] as const;

type Layer = (typeof LAYER_ORDER)[number];

/**
 * Directories under `src/` that are not part of the ordered chain.
 * - `runtime/`: design.md 「`runtime/` は最も外側。上のどこからも import されない」 — it may
 *   import anything, and nothing in the chain may import it.
 * - `generated/`: Prisma's generated client output, not hand-written source.
 */
const OUTERMOST_DIR = 'runtime';
const GENERATED_DIR = 'generated';
/**
 * The end-to-end harness (task 11.1). Outside the ordered chain for the same
 * reason `runtime/` is -- it drives the whole app, so it may import any layer,
 * and nothing in the chain may import it back. It is deliberately NOT in
 * `EXCLUDED_DIRS`: that list is skipped by the walk entirely, which would also
 * lift the Chat SDK, generated-client and db-barrel guards off it. Naming it
 * here instead leaves all three in force -- so the fakes have to be built out
 * of this app's own vocabulary rather than out of Chat SDK types.
 */
const TESTING_DIR = 'testing';
const EXCLUDED_DIRS = [GENERATED_DIR];

/** A file that belongs to no layer: `src/*.ts` and `src/runtime/**`. Same rules as runtime. */
const OUTERMOST = 'outermost';

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return EXCLUDED_DIRS.includes(relative(SRC_DIR, full))
        ? []
        : listSourceFiles(full);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });

const layerOf = (absolutePath: string): Layer | typeof OUTERMOST => {
  // A specifier may name the layer directory itself (`from '../types'`), so the layer name
  // counts whether or not a path segment follows it. Anything else under src/ — a file
  // directly in src/, or runtime/ — is outside the ordered chain.
  const head = relative(SRC_DIR, absolutePath).split(sep)[0];
  return (LAYER_ORDER as readonly string[]).includes(head)
    ? (head as Layer)
    : OUTERMOST;
};

/**
 * Import specifiers of a file: `import`/`export ... from '…'`, side-effect `import '…'`, and
 * dynamic `import('…')`.
 *
 * The first two patterns are anchored to the start of a line AND forbid matching across a
 * newline (`[^'"\n]*` instead of `[^'"]*`): a line that opens with `import`/`export`/`}` can
 * only be turned into a match by a `from '...'` clause on THAT SAME line, never by text found
 * later in the file (e.g. inside a following comment or doc block). This matches the import
 * style used throughout this app; it is not a general TypeScript parser. One known gap this
 * accepts: a multi-line `import { ... } from '...'` whose closing `}` and `from '...'` end up
 * on different lines would no longer be matched — but `pnpm exec biome check` reformats such
 * an import onto a single closing line in this codebase, so no legal source file here can take
 * that shape.
 */
const STATEMENT_PATTERNS = [
  /^\s*(?:import|export)\b[^'"\n]*\bfrom\s*['"]([^'"]+)['"]/gm,
  /^\s*\}[^'"\n]*\bfrom\s*['"]([^'"]+)['"]/gm, // closing line of a multi-line import/export
  /^\s*import\s*['"]([^'"]+)['"]/gm, // side-effect import
  /\bimport\(\s*['"`]([^'"`]+)['"`]\s*\)/g, // dynamic import (quote, double-quote, or backtick)
];

const importSpecifiersOf = (absolutePath: string): string[] => {
  const source = readFileSync(absolutePath, 'utf8');
  // Deduplicated: a multi-line statement matches both the opening and the closing pattern,
  // and one specifier reported twice only makes a failure harder to read.
  return [
    ...new Set(
      STATEMENT_PATTERNS.flatMap((pattern) =>
        [...source.matchAll(pattern)].map(([, specifier]) => specifier),
      ),
    ),
  ];
};

const toDisplayPath = (absolutePath: string): string =>
  `src/${relative(SRC_DIR, absolutePath).split(sep).join('/')}`;

const SOURCE_FILES = listSourceFiles(SRC_DIR);

/**
 * Writes `source` to a throwaway `.ts` file OUTSIDE `src/` and returns its absolute path, so
 * `importSpecifiersOf()` can be exercised on a real file without the fixture's own literal text
 * being picked up by the `src/` walk (`SOURCE_FILES`) that the layer-order and Chat SDK tests
 * below rely on.
 */
const writeFixture = (source: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-proxy-architecture-'));
  const path = join(dir, 'fixture.ts');
  writeFileSync(path, source);
  return path;
};

describe('importSpecifiersOf: what must NOT be flagged', () => {
  // Both of these are real, biome-clean shapes: an `export`/`import` statement followed on a
  // LATER line by unrelated text that happens to contain `from '...'`. Before the STATEMENT_PATTERNS
  // fix, `[^'"]*` matched across the newline and misread the comment as the statement's own
  // `from` clause.
  it("does not read a comment on the line after an export as that export's import source", () => {
    const fixture = writeFixture(
      `export const a = 1;\n// moved from '../routes/old.js'\n`,
    );

    expect(importSpecifiersOf(fixture)).not.toContain('../routes/old.js');
  });

  it('does not read a doc comment after an export as a Chat SDK import', () => {
    const fixture = writeFixture(
      `export const X = 1;\n/** Re-exported from 'chat' for convenience. */\n`,
    );

    expect(importSpecifiersOf(fixture)).not.toContain('chat');
  });
});

describe('importSpecifiersOf: what MUST be flagged', () => {
  it('recognizes a backtick-quoted dynamic import', () => {
    // Built via concatenation, not a literal `import(\`...\`)` substring: the dynamic-import
    // pattern is intentionally NOT line-anchored (it must catch a call anywhere on a line), so
    // a literal occurrence of that text in THIS file would be picked up by the very check this
    // fixture exercises (this file is itself walked as part of src/).
    const DYNAMIC_IMPORT_CALL = 'import';
    const fixture = writeFixture(
      `export const load = () => ${DYNAMIC_IMPORT_CALL}(\`chat\`);\n`,
    );

    expect(importSpecifiersOf(fixture)).toContain('chat');
  });
});

describe('layer order', () => {
  it('has at least the currently implemented layers to check', () => {
    // Guards against the walker silently finding nothing (a broken glob would make every
    // assertion below vacuously pass).
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
    expect(new Set(SOURCE_FILES.map(layerOf))).toContain('types');
  });

  it('every directory under src/ is a declared layer, runtime/, testing/, or generated/', () => {
    // Without this, a new top-level directory would fall through to OUTERMOST and escape
    // the layer-order guard entirely.
    const known = [
      ...LAYER_ORDER,
      OUTERMOST_DIR,
      TESTING_DIR,
      ...EXCLUDED_DIRS,
    ];
    const unknown = readdirSync(SRC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !known.includes(entry.name))
      .map((entry) => entry.name);

    expect(unknown).toEqual([]);
  });

  it('never imports a layer to the right of its own, nor runtime/', () => {
    const violations = SOURCE_FILES.flatMap((file) => {
      const importerLayer = layerOf(file);
      if (importerLayer === OUTERMOST) return []; // runtime/ and src/*.ts may import anything

      return importSpecifiersOf(file)
        .filter((specifier) => specifier.startsWith('.'))
        .flatMap((specifier) => {
          const resolved = resolve(dirname(file), specifier);
          const fromSrc = relative(SRC_DIR, resolved);
          if (fromSrc.startsWith('..')) return []; // outside src/
          // Not a layer, and legal from exactly one place — judged by the
          // generated-client origin guard below instead.
          if (fromSrc.split(sep)[0] === GENERATED_DIR) return [];
          const importedLayer = layerOf(resolved);
          const allowed =
            importedLayer !== OUTERMOST &&
            LAYER_ORDER.indexOf(importedLayer) <=
              LAYER_ORDER.indexOf(importerLayer);
          return allowed
            ? []
            : [
                `${toDisplayPath(file)} (${importerLayer}) imports '${specifier}' (${importedLayer})`,
              ];
        });
    });

    expect(violations).toEqual([]);
  });
});

describe('Chat SDK import origin', () => {
  /**
   * design.md Allowed Dependencies: these may be used from `src/platform/**` only.
   * `@growi/chat` is explicitly allowed from every layer and is NOT part of this list.
   */
  const RESTRICTED_PACKAGES = [
    'chat',
    '@chat-adapter/slack',
    '@chat-adapter/discord',
    '@chat-adapter/teams',
    '@chat-adapter/state-pg',
    'chat-adapter-mattermost',
  ];
  const PLATFORM_DIR = `platform${sep}`;

  const isRestricted = (specifier: string): boolean =>
    // `@chat-adapter/*` is matched by prefix so that a newly added adapter is restricted
    // without editing this list.
    specifier.startsWith('@chat-adapter/') ||
    RESTRICTED_PACKAGES.some(
      (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
    );

  it('is imported from src/platform/** only', () => {
    const violations = SOURCE_FILES.filter(
      (file) => !relative(SRC_DIR, file).startsWith(PLATFORM_DIR),
    ).flatMap((file) =>
      importSpecifiersOf(file)
        .filter(isRestricted)
        .map((specifier) => `${toDisplayPath(file)} imports '${specifier}'`),
    );

    expect(violations).toEqual([]);
  });

  it('recognizes the real Chat SDK imports that made this guard necessary', () => {
    // Until task 3.1 no file imported the SDK at all, so the rule above passed
    // vacuously -- exactly the failure mode the generated-client guard below
    // guards against with its own positive case. `platform/adapter-set.ts` is
    // the one file design.md puts in front of the SDK's adapter constructors,
    // so it is the honest positive case rather than a synthetic fixture.
    const specifiers = importSpecifiersOf(
      join(SRC_DIR, 'platform', 'adapter-set.ts'),
    ).filter(isRestricted);

    expect(specifiers.sort()).toEqual(
      [
        '@chat-adapter/discord',
        '@chat-adapter/slack',
        '@chat-adapter/state-pg',
        '@chat-adapter/teams',
        'chat',
        'chat-adapter-mattermost',
      ].sort(),
    );
  });

  it('does not restrict @growi/chat', () => {
    expect(isRestricted('@growi/chat')).toBe(false);
    expect(isRestricted('@growi/chat/dist/interfaces')).toBe(false);
  });
});

describe('Prisma generated client import origin', () => {
  /**
   * design.md's File Structure Plan puts `db/prisma-client.ts` between the generated client
   * and the rest of the app. Reaching `src/generated/**` from any other layer would put a
   * generated model type — and the connection it is bound to — into a layer that is supposed
   * to see only the repository surface `db/` publishes.
   */
  const DB_DIR = `db${sep}`;

  const generatedImportsOf = (file: string): string[] =>
    importSpecifiersOf(file)
      .filter((specifier) => specifier.startsWith('.'))
      .filter(
        (specifier) =>
          relative(SRC_DIR, resolve(dirname(file), specifier)).split(sep)[0] ===
          GENERATED_DIR,
      );

  it('is imported from src/db/** only', () => {
    const violations = SOURCE_FILES.filter(
      (file) => !relative(SRC_DIR, file).startsWith(DB_DIR),
    ).flatMap((file) =>
      generatedImportsOf(file).map(
        (specifier) => `${toDisplayPath(file)} imports '${specifier}'`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('recognizes the real import that made this guard necessary', () => {
    // Without a positive case the rule above passes vacuously the moment `generatedImportsOf`
    // stops matching anything — the same reason the Chat SDK guard asserts its own predicate.
    // `db/prisma-client.ts` is the one file design.md puts in front of the generated client,
    // so it is the honest positive case rather than a synthetic fixture.
    expect(generatedImportsOf(join(SRC_DIR, 'db', 'prisma-client.ts'))).toEqual(
      ['../generated/prisma/client.js'],
    );
  });

  it('does not read an ordinary sibling import as a generated-client import', () => {
    expect(generatedImportsOf(join(SRC_DIR, 'types', 'index.ts'))).toEqual([]);
  });
});

describe('db barrel import origin', () => {
  /**
   * design.md's File Structure Plan marks `db/index.ts` "この層の公開窓口" (this layer's
   * public entry point) — the storage layer's declared single way in. Task 2.3 added the two
   * barrels (`db/index.ts` and `db/repositories/index.ts`); this guard is what makes bypassing
   * them (`import { createRelationRepository } from '../db/repositories/relation-repository.js'`)
   * a caught violation rather than a convention nobody enforces.
   *
   * Written generically (a resolved-path check against every file, not a check that today's
   * tree is clean) so it automatically covers every future caller in `platform/`, `command/`,
   * `relation/`, `growi/`, `orchestration/`, and `routes/` once those layers exist — the same
   * "binds files that don't exist yet" shape task 1.7's `LAYER_ORDER` walk and this file's other
   * guards already use.
   */
  const DB_DIR = `db${sep}`;

  /**
   * Barrel paths, extension-stripped. Every relative import specifier in this app's real
   * source resolves to a `.js` path (Implementation Note 1.1: `tsc` emits import specifiers
   * verbatim, and Node cannot resolve an extensionless relative import at runtime), while
   * `SOURCE_FILES` walks `.ts` files on disk — so a resolved specifier path (`db/index.js`)
   * and the on-disk barrel path (`db/index.ts`) never compare equal without stripping the
   * extension from both sides first. Comparing them directly would make the guard reject the
   * one legal way to reach `db/` (`from './db/index.js'`), which is worse than not having the
   * guard at all.
   */
  const withoutExtension = (path: string): string =>
    path.replace(/\.(?:ts|js)$/, '');
  const BARRELS = new Set(
    [
      join(SRC_DIR, 'db', 'index.ts'),
      join(SRC_DIR, 'db', 'repositories', 'index.ts'),
    ].map(withoutExtension),
  );

  /** True for any `db/` file other than its own two declared entry points. */
  const isDbInternal = (resolvedPath: string): boolean =>
    relative(SRC_DIR, resolvedPath).startsWith(DB_DIR) &&
    !BARRELS.has(withoutExtension(resolvedPath));

  const dbInternalImportsOf = (file: string): string[] =>
    importSpecifiersOf(file)
      .filter((specifier) => specifier.startsWith('.'))
      .filter((specifier) => isDbInternal(resolve(dirname(file), specifier)));

  /**
   * A relative specifier from `fromDir` to `toFile`, always prefixed so it reads as relative,
   * and always `.js`-suffixed (`toFile` is passed as a `.ts` path on disk) to match the import
   * style every real source file in this app uses.
   */
  const relativeSpecifierTo = (fromDir: string, toFile: string): string => {
    const rel = relative(fromDir, toFile)
      .replace(/\.ts$/, '.js')
      .split(sep)
      .join('/');
    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  it('is reached only through its declared barrels (db/index.ts, db/repositories/index.ts), never by importing a repository file or prisma-client.ts directly', () => {
    const violations = SOURCE_FILES.filter(
      (file) => !relative(SRC_DIR, file).startsWith(DB_DIR),
    ).flatMap((file) =>
      dbInternalImportsOf(file).map(
        (specifier) => `${toDisplayPath(file)} imports '${specifier}'`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('recognizes a direct import of a repository file, bypassing the barrel, as a violation', () => {
    // A fixture outside src/ (same reason writeFixture() lives outside src/ elsewhere in this
    // file): SOURCE_FILES walks src/, so a violating file placed inside it would change what
    // the assertion above is checking.
    const fixtureDir = mkdtempSync(join(tmpdir(), 'chat-proxy-architecture-'));
    const fixturePath = join(fixtureDir, 'fixture.ts');
    const target = join(
      SRC_DIR,
      'db',
      'repositories',
      'relation-repository.ts',
    );
    const specifier = relativeSpecifierTo(fixtureDir, target);
    writeFileSync(
      fixturePath,
      `import { createRelationRepository } from '${specifier}';\n`,
    );

    expect(dbInternalImportsOf(fixturePath)).toEqual([specifier]);
  });

  it('does not flag an import of the db barrel itself', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'chat-proxy-architecture-'));
    const fixturePath = join(fixtureDir, 'fixture.ts');
    const target = join(SRC_DIR, 'db', 'index.ts');
    const specifier = relativeSpecifierTo(fixtureDir, target);
    writeFileSync(
      fixturePath,
      `import { createPrismaClient } from '${specifier}';\n`,
    );

    expect(dbInternalImportsOf(fixturePath)).toEqual([]);
  });

  it('does not flag an import of the repositories barrel itself', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'chat-proxy-architecture-'));
    const fixturePath = join(fixtureDir, 'fixture.ts');
    const target = join(SRC_DIR, 'db', 'repositories', 'index.ts');
    const specifier = relativeSpecifierTo(fixtureDir, target);
    writeFileSync(
      fixturePath,
      `import { createRelationRepository } from '${specifier}';\n`,
    );

    expect(dbInternalImportsOf(fixturePath)).toEqual([]);
  });

  it('does not flag the exact import a future src/routes/** file will legally write', () => {
    // The real-world positive case: every file this guard will actually see once task 3.x
    // exists reaches db/ through 'db/index.js', not through a '.ts' specifier -- so this test
    // has to write the same '.js'-suffixed specifier relativeSpecifierTo() produces, not a
    // hand-picked one, or it would not have caught the extension mismatch this guard once had.
    const fixtureDir = mkdtempSync(join(tmpdir(), 'chat-proxy-architecture-'));
    const fixturePath = join(fixtureDir, 'fixture.ts');
    const target = join(SRC_DIR, 'db', 'index.ts');
    const specifier = relativeSpecifierTo(fixtureDir, target);
    writeFileSync(
      fixturePath,
      `import { createRelationRepository } from '${specifier}';\n`,
    );

    expect(specifier.endsWith('.js')).toBe(true);
    expect(dbInternalImportsOf(fixturePath)).toEqual([]);
  });
});
