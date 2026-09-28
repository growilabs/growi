import fs from 'node:fs';
import path from 'node:path';

// Verifies the theme-overridable inline comment highlight token declared in
// _marker.scss:root. See requirements.md Requirement 12 (12.1, 12.2) and
// design.md "決定1" for why this indirection (rather than reading
// --grw-marker-bg directly) is required.
describe('_marker.scss inline comment highlight token', () => {
  const scssPath = path.join(__dirname, '_marker.scss');
  const scssSource = fs.readFileSync(scssPath, 'utf-8');

  it('declares --grw-inline-comment-marker-bg in :root, defaulting to the search marker color', () => {
    const rootBlockMatch = scssSource.match(/:root\s*\{([^}]*)\}/);
    expect(rootBlockMatch).not.toBeNull();

    const rootBlockBody = rootBlockMatch?.[1] ?? '';
    expect(rootBlockBody).toContain(
      '--grw-inline-comment-marker-bg: var(--grw-marker-bg, var(--grw-marker-bg-yellow));',
    );
  });

  // See requirements.md (inline-comment-interaction-ux) Requirement 1.3, 1.4
  // and design.md "決定1": the pending (in-creation) highlight needs its own
  // theme-overridable token that defaults to a different marker color family
  // than the saved-highlight token above, so the two are distinguishable
  // out of the box.
  it('declares --grw-inline-comment-marker-bg-pending in :root, defaulting to a different marker color family than the saved highlight', () => {
    const rootBlockMatch = scssSource.match(/:root\s*\{([^}]*)\}/);
    expect(rootBlockMatch).not.toBeNull();

    const rootBlockBody = rootBlockMatch?.[1] ?? '';
    expect(rootBlockBody).toContain(
      '--grw-inline-comment-marker-bg-pending: var(--grw-inline-comment-marker-bg-pending-override, var(--grw-marker-bg-blue));',
    );

    // Extract each declared token's fallback chain and confirm the pending
    // token's ultimate fallback color variable differs from the saved
    // token's (--grw-marker-bg-yellow vs --grw-marker-bg-blue).
    const savedMatch = rootBlockBody.match(
      /--grw-inline-comment-marker-bg:\s*var\([^;]*\);/,
    );
    const pendingMatch = rootBlockBody.match(
      /--grw-inline-comment-marker-bg-pending:\s*var\([^;]*\);/,
    );
    expect(savedMatch).not.toBeNull();
    expect(pendingMatch).not.toBeNull();
    expect(pendingMatch?.[0]).not.toEqual(savedMatch?.[0]);

    const fallbackColorVarOf = (declaration: string): string | undefined => {
      const fallbackVarNames = [
        ...declaration.matchAll(/var\((--[\w-]+)/g),
      ].map((m) => m[1]);
      return fallbackVarNames.at(-1);
    };
    expect(fallbackColorVarOf(pendingMatch?.[0] ?? '')).not.toEqual(
      fallbackColorVarOf(savedMatch?.[0] ?? ''),
    );
  });
});
