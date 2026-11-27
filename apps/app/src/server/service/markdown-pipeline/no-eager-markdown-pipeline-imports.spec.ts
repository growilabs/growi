import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOT_ENTRYPOINTS } from '~/test-utils/boot-entrypoints';
import {
  formatViolation,
  traceStaticImportChains,
} from '~/test-utils/static-import-graph';

// --- Contract --------------------------------------------------------------
//
// The unified/remark/rehype stack (with KaTeX and the sanitizer) is loaded
// only when a page body is actually rendered on the server (page-bulk-export,
// inline comments created from a markdown quote) — never at server boot.
// The inline-comment create route is registered at boot and imports this
// pipeline statically, so the pipeline must keep every plugin behind a
// dynamic import() (esm-plugin-loader / plugin-set).
//
// Two walks, per .claude/rules/server-boot-imports.md: from the pipeline's own
// entry (its internal static graph) and from the boot entrypoints (any other
// boot-reachable module importing the stack directly).

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const MARKDOWN_STACK_PACKAGE =
  /^(unified|remark-[^/]+|rehype-[^/]+|mdast-[^/]+|hast-util-sanitize|katex)($|\/)/;

const PIPELINE_ENTRYPOINTS = ['server/service/markdown-pipeline/index.ts'];

const expectNoViolations = (entrypoints: readonly string[], hint: string) => {
  const formatted = traceStaticImportChains({
    srcRoot: SRC_ROOT,
    entrypoints,
    bannedPattern: MARKDOWN_STACK_PACKAGE,
  }).map(formatViolation);

  expect(formatted, `${hint}\n\n${formatted.join('\n\n')}`).toEqual([]);
};

const expectEntrypointsExist = (entrypoints: readonly string[]) => {
  for (const entry of entrypoints) {
    expect(
      fs.existsSync(path.join(SRC_ROOT, entry)),
      `entrypoint disappeared: ${entry} — update the list this spec walks from`,
    ).toBe(true);
  }
};

describe('lazy-load boundary for the server markdown stack', () => {
  it('has no static import chain from the markdown pipeline entry to unified / remark / rehype / mdast / hast-util-sanitize / katex', () => {
    expectNoViolations(
      PIPELINE_ENTRYPOINTS,
      'The markdown pipeline must load the unified stack via dynamic import() ' +
        '(declare plugins in plugin-set.ts), not a top-level import.',
    );
  });

  it('still finds the markdown pipeline entrypoint it traces from', () => {
    expectEntrypointsExist(PIPELINE_ENTRYPOINTS);
  });
});

describe('boot-time import boundary for the server markdown stack', () => {
  it('has no static import chain from a boot entrypoint to unified / remark / rehype / mdast / hast-util-sanitize / katex', () => {
    expectNoViolations(
      BOOT_ENTRYPOINTS,
      'Boot entrypoints must not statically reach the unified stack. Render ' +
        "through '~/server/service/markdown-pipeline', which loads it lazily.",
    );
  });

  it('still finds every boot entrypoint it traces from', () => {
    expectEntrypointsExist(BOOT_ENTRYPOINTS);
  });
});
