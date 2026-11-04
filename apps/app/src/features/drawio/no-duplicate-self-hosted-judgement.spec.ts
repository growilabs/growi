import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Contract --------------------------------------------------------------
//
// `isSelfHostedDrawio` is the single basis on which the viewer side
// (client/self-hosted) and the asset-serving side (server/routes/drawio-assets)
// decide whether the configured draw.io is someone's own instance
// (requirement 8.4). The failure it exists to prevent is one half treating an
// instance as self-hosted while the other does not: the client would rebase the
// viewer's asset paths onto GROWI's origin while the route answered 404 to every
// one of those requests, or the reverse.
//
// Counting the call sites of `isSelfHostedDrawio` cannot guard that — adding a
// second, independent judgement elsewhere does not reduce the number of call
// sites. What can be guarded is the *material* the judgement is made of:
// draw.io's own origin. So this scans the draw.io sources and requires that
// every reference to that origin — the `DEFAULT_DRAWIO_ORIGIN` constant, or the
// host written out literally — lives in one of the two files allowed to know it.
// Both shapes a real second implementation could take are therefore caught: one
// that imports the constant and compares against it, and one that inlines
// `new URL(uri).origin !== 'https://embed.diagrams.net'`.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/**
 * Where a second judgement could plausibly be written.
 *
 * Wider than `features/drawio/` on purpose. The two directories outside it hold
 * the code that *calls* the entry points and builds the editor URL, which is
 * exactly where someone reaching for "is this the default draw.io?" would be
 * standing — so leaving them out would leave the realistic drift unguarded.
 *
 * Deliberately not the whole of `src`: `service/config-manager` carries
 * draw.io's own URL as the *default value* of the `DRAWIO_URI` setting, which is
 * a legitimate mention of the host and not a judgement. Keeping the scan to the
 * draw.io code keeps the matcher able to stay dumb and literal.
 */
const SCAN_ROOTS = [
  'features/drawio',
  'client/components/PageEditor/DrawioModal',
  'components/Script/DrawioViewerScript',
];

/** The only files allowed to know what draw.io's own origin is. */
const ALLOWED_FILES = [
  'features/drawio/consts.ts',
  'features/drawio/is-self-hosted-drawio.ts',
];

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Test files are not scanned: they legitimately construct default-origin URLs to
 * drive the judgement (`is-self-hosted-drawio.spec.ts`,
 * `client/self-hosted/index.spec.ts`) or replace the constant with a fixture
 * origin (`server/routes/drawio-assets.spec.ts`). A judgement written in a test
 * is also not the drift this guards — only production code decides how GROWI
 * talks to the configured instance.
 */
const TEST_FILE = /\.(spec|integ)\.[jt]sx?$/;

const DEFAULT_ORIGIN_CONSTANT = /\bDEFAULT_DRAWIO_ORIGIN\b/;

/**
 * draw.io's own host written out literally, in any form
 * (`https://embed.diagrams.net`, `app.diagrams.net`, a bare `diagrams.net`).
 *
 * `viewer.diagrams.net` is excluded: that is `VIEWER_DIAGRAMS_NET_ORIGIN`, the
 * fallback for libraries an older self-hosted image does not ship, and it plays
 * no part in deciding whether the configured instance is self-hosted.
 */
const DEFAULT_ORIGIN_LITERAL = /(?<!viewer\.)\bdiagrams\.net/;

type OriginReference = {
  /** Path relative to `src`, with `/` separators on every platform. */
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

const toPosix = (relativePath: string): string =>
  relativePath.split(path.sep).join('/');

const listScannedFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listScannedFiles(full);
    }
    if (!entry.isFile() || TEST_FILE.test(entry.name)) {
      return [];
    }
    return SCANNED_EXTENSIONS.includes(path.extname(entry.name)) ? [full] : [];
  });

/**
 * Every mention of draw.io's own origin in the scanned sources, allowed or not.
 *
 * Comments are scanned along with code. A file that has to name draw.io's own
 * host to explain itself is already deriving the judgement locally, and the
 * failure names the line so the fix (call `isSelfHostedDrawio`, or point at the
 * two files) is obvious. It also keeps this matcher purely lexical: a
 * comment-stripping pass could go wrong and quietly stop matching real code,
 * which is the one failure mode a drift test must not have.
 */
const collectDefaultOriginReferences = (): OriginReference[] =>
  SCAN_ROOTS.flatMap((root) =>
    listScannedFiles(path.join(SRC_ROOT, root)).flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((text, index) =>
          DEFAULT_ORIGIN_CONSTANT.test(text) ||
          DEFAULT_ORIGIN_LITERAL.test(text)
            ? [
                {
                  file: toPosix(path.relative(SRC_ROOT, file)),
                  line: index + 1,
                  text: text.trim(),
                },
              ]
            : [],
        ),
    ),
  );

const formatReference = (reference: OriginReference): string =>
  `${reference.file}:${reference.line}: ${reference.text}`;

describe('single basis for the self-hosted draw.io judgement', () => {
  it("should keep draw.io's own origin out of every file but the two allowed to know it", () => {
    const strays = collectDefaultOriginReferences()
      .filter((reference) => !ALLOWED_FILES.includes(reference.file))
      .map(formatReference);

    expect(
      strays,
      'Whether the configured draw.io is self-hosted is decided in one place: ' +
        `isSelfHostedDrawio (${ALLOWED_FILES[1]}), on the constant in ` +
        `${ALLOWED_FILES[0]}. The viewer side and the serving side must answer ` +
        'that question identically, so a second comparison against draw.io own ' +
        'origin — inline or through the constant — is what this forbids. Call ' +
        'isSelfHostedDrawio instead.\n\n' +
        `${strays.join('\n')}`,
    ).toEqual([]);
  });

  // Guards the guard: without these, a rename of either allowed file, a moved
  // directory, or a matcher that stopped matching would leave the scan finding
  // nothing at all — and an empty result reads exactly like a clean codebase.
  it('should still find the directories and the files it is written against', () => {
    for (const root of SCAN_ROOTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, root)),
        `scanned directory disappeared: ${root} — update SCAN_ROOTS`,
      ).toBe(true);
    }
    for (const file of ALLOWED_FILES) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, file)),
        `allowed file disappeared: ${file} — update ALLOWED_FILES`,
      ).toBe(true);
    }
  });

  it.each(
    ALLOWED_FILES,
  )('should still match the origin reference in %s, proving the scan can see one', (allowedFile) => {
    const filesWithAReference = collectDefaultOriginReferences().map(
      (reference) => reference.file,
    );

    expect(
      filesWithAReference,
      `${allowedFile} is expected to name draw.io own origin — it is where the ` +
        'judgement lives. Not matching it means the scan or the matcher stopped ' +
        'working, and the test above is passing without checking anything.',
    ).toContain(allowedFile);
  });
});
