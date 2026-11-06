import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Task 3.4 of inline-comment-visual-consistency (Requirement 11.2 / 12.2)
 * guards against literal color values creeping back into this feature after
 * tasks 2.1/2.2/3.1 removed the last one (`InlineCommentHighlight.tsx`'s
 * `rgba(255, 193, 7, 0.35)`). Colors here must come from Bootstrap 5 classes
 * or theme-provided CSS custom properties (see design.md "Testing Strategy").
 */

const FEATURE_ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_EXTENSIONS = ['.ts', '.tsx', '.scss'] as const;
const LITERAL_COLOR_PATTERNS = [/#[0-9a-fA-F]{3,8}/, /rgb\(/, /rgba\(/];

function collectTargetFiles(rootDir: string): string[] {
  return fs
    .readdirSync(rootDir, { recursive: true })
    .map((entry) => path.join(rootDir, entry.toString()))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .filter((filePath) =>
      TARGET_EXTENSIONS.includes(
        path.extname(filePath) as (typeof TARGET_EXTENSIONS)[number],
      ),
    )
    .filter((filePath) => !path.basename(filePath).includes('.spec.'));
}

describe('inline-comment feature has no literal color values', () => {
  const targetFiles = collectTargetFiles(FEATURE_ROOT);

  // Guards against the walk silently matching nothing (e.g. a broken glob),
  // which would make every assertion below vacuously true.
  it('found at least one .ts/.tsx/.scss file to check', () => {
    expect(targetFiles.length).toBeGreaterThan(0);
  });

  it.each(targetFiles)('%s has no literal color value', (filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');

    for (const pattern of LITERAL_COLOR_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });
});
