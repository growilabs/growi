import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BODY_CHAR_LIMIT,
  CONSTANT_DECLARATIONS,
  CONSTANT_GROUPS,
  type ConstantSource,
  PAUSE_WINDOW_SECONDS,
  REPRO_RESULT_LINE_PREFIXES,
} from './constants.ts';

// Drift detection (design.md → constants.ts, Requirement 4.2).
//
// Deviation from the task text, deliberate and recorded here: the task asks for
// every string in constants.ts to appear in `flaky-ci-routine.md`'s
// `## Shared constants` section. That section defines only the needs-decision
// label, the Recommendation line, the two automated-author signatures and the
// 120-second pause window. The tier labels, the comment headings and the
// dashboard's zero-state lines are defined elsewhere in the same file, the
// `**Fix PR**: ` marker by the skill that writes it
// (`investigate-flaky-test/SKILL.md` 6-C), and the `### Repro result` line
// headings by `flaky-repro.yml`. So each
// constant declares which file (and, for the Shared constants group, which
// section) it is checked against, and this spec checks all of them — nothing is
// dropped, and nothing is asserted against a place it was never written.

const repoRoot = new URL('../../../', import.meta.url);

const SOURCE_FILES: Readonly<Record<ConstantSource, string>> = {
  'routine-shared-constants': '.claude/commands/flaky-ci-routine.md',
  'routine-doc': '.claude/commands/flaky-ci-routine.md',
  'flaky-repro-workflow': '.github/workflows/flaky-repro.yml',
  'investigate-doc': '.claude/skills/investigate-flaky-test/SKILL.md',
};

const readRepoFile = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, repoRoot)), 'utf8');

/** The `## Shared constants` section: from its heading to the next `## ` heading. */
const sharedConstantsSection = (markdown: string): string => {
  const lines = markdown.split('\n');
  const start = lines.indexOf('## Shared constants');
  expect(start, 'the `## Shared constants` heading must exist').toBeGreaterThan(
    -1,
  );
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
};

const sourceText = (source: ConstantSource): string => {
  const file = readRepoFile(SOURCE_FILES[source]);
  return source === 'routine-shared-constants'
    ? sharedConstantsSection(file)
    : file;
};

const declaredTexts = new Set(CONSTANT_DECLARATIONS.map(({ text }) => text));

const stringLeaves = (value: unknown): readonly string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringLeaves);
  }
  if (typeof value === 'object' && value != null) {
    return Object.values(value).flatMap(stringLeaves);
  }
  return [];
};

describe('constants — drift detection against the procedure documents', () => {
  it.each(
    CONSTANT_DECLARATIONS,
  )('$name is spelled the same way in its source ($source)', ({
    text,
    source,
  }) => {
    expect(sourceText(source)).toContain(text);
  });

  it('checks the Shared constants group against that section only', () => {
    const section = sourceText('routine-shared-constants');
    expect(section).toContain('flaky/needs-decision');
    // A string that lives elsewhere in the same file must not be accepted by
    // this narrower source, or the group would prove nothing.
    expect(section).not.toContain('### Backfilled observation');
  });

  it('states the pause window with the same number of seconds as the procedure', () => {
    expect(sourceText('routine-shared-constants')).toContain(
      `${PAUSE_WINDOW_SECONDS} seconds`,
    );
  });

  it('states the dashboard body limit with the same number of characters as the procedure', () => {
    expect(sourceText('routine-doc')).toContain(`${BODY_CHAR_LIMIT}-character`);
  });

  it('keeps the `### Repro result` seven line headings in the workflow order', () => {
    const workflow = sourceText('flaky-repro-workflow');
    const positions = REPRO_RESULT_LINE_PREFIXES.map((prefix) =>
      workflow.indexOf(prefix),
    );
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(REPRO_RESULT_LINE_PREFIXES).toHaveLength(7);
  });
});

describe('constants — every exported string is covered by a declaration', () => {
  it.each(
    stringLeaves(CONSTANT_GROUPS),
  )('%j is declared with a verification source', (value) => {
    expect(declaredTexts).toContain(value);
  });
});
