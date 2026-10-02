/**
 * Drift guard for the tool manifest in SKILL.md.
 *
 * The esm-merge-coverage skill drives repo tooling that lives outside this
 * directory (tools/codemod, tools/lint, bin/). Nothing in the build would
 * notice if one of those tools were renamed or deleted — the skill would just
 * instruct an agent to run a command that no longer exists. This spec binds the
 * two together: every path listed in the skill's "## Tools" table must resolve
 * to a real file.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = resolve(HERE, 'SKILL.md');
// SKILL.md documents tool paths relative to apps/app/
const APP_ROOT = resolve(HERE, '../../..');

/** Paths appear as the leading code span of each row in the "## Tools" table. */
const extractToolPaths = (markdown: string): string[] => {
  const section = markdown.split(/^## Tools$/m)[1]?.split(/^## /m)[0] ?? '';
  return Array.from(section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)).map(
    (match) => match[1],
  );
};

describe('esm-merge-coverage tool manifest', () => {
  it('declares tool paths in SKILL.md', async () => {
    const markdown = await readFile(SKILL_MD, 'utf8');

    // Guard the guard: a parser that silently matches nothing would make the
    // existence assertion below pass vacuously forever.
    expect(extractToolPaths(markdown).length).toBeGreaterThanOrEqual(5);
  });

  it('points every declared tool at a file that exists', async () => {
    const markdown = await readFile(SKILL_MD, 'utf8');

    const missing = extractToolPaths(markdown).filter(
      (toolPath) => !existsSync(resolve(APP_ROOT, toolPath)),
    );

    expect(missing).toEqual([]);
  });
});
