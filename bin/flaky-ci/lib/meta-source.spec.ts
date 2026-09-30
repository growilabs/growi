import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseMetaSource } from './meta-source.ts';

const readFixture = (relativePath: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${relativePath}`, import.meta.url)),
    'utf8',
  );

describe('parseMetaSource', () => {
  describe('real-checkable — typical `gh api -X GET repos/growilabs/growi/...` form, no -q', () => {
    it('classifies a bare path with no query/paginate/flags', () => {
      const text = readFixture('api/commits/0d1a319a-pulls.json.meta.md');
      expect(parseMetaSource(text)).toEqual({
        kind: 'real-checkable',
        path: 'repos/growilabs/growi/commits/0d1a319a106b2a791e883170782e856f88b0e178/pulls',
        params: {},
        paginate: false,
      });
    });

    it('classifies a path with --paginate (comments)', () => {
      const text = readFixture('api/issues/11821-comments.json.meta.md');
      expect(parseMetaSource(text)).toEqual({
        kind: 'real-checkable',
        path: 'repos/growilabs/growi/issues/11821/comments',
        params: {},
        paginate: true,
      });
    });

    it('classifies a path with multiple -f key=value flags, converting numeric values to numbers', () => {
      const text = readFixture(
        'api/issues/fetch-flaky-issues-confirmed-page1.json.meta.md',
      );
      expect(parseMetaSource(text)).toEqual({
        kind: 'real-checkable',
        path: 'repos/growilabs/growi/issues',
        params: {
          state: 'all',
          labels: 'flaky/confirmed',
          per_page: 3,
          page: 1,
        },
        paginate: false,
      });
    });

    it('classifies a path with --paginate (pulls files)', () => {
      const text = readFixture('api/pulls/11919-files.json.meta.md');
      expect(parseMetaSource(text)).toEqual({
        kind: 'real-checkable',
        path: 'repos/growilabs/growi/pulls/11919/files',
        params: {},
        paginate: true,
      });
    });

    it('always returns a path that starts with the repos/growilabs/growi/ prefix, for every cataloged real-checkable fixture', () => {
      // Without this prefix, downstream `gh api -X GET <path>` calls resolve
      // against the wrong GitHub route: e.g. a path of `issues` (missing the
      // `repos/growilabs/growi/` prefix) hits the *global*
      // "issues assigned to the authenticated user" endpoint instead of this
      // repo's issue list, returns 200 with unrelated data, and gets
      // silently recorded as "checked, no drift" without ever validating
      // anything against the fixture's real source.
      const realCheckableFixtures = [
        'api/commits/0d1a319a-pulls.json.meta.md',
        'api/commits/807c3628-pulls.json.meta.md',
        'api/issues/11821-comments.json.meta.md',
        'api/issues/11821-issue.json.meta.md',
        'api/issues/11823-comments.json.meta.md',
        'api/issues/11823-events.json.meta.md',
        'api/issues/11900-comments.json.meta.md',
        'api/issues/11900-issue.json.meta.md',
        'api/issues/11914-comments.json.meta.md',
        'api/issues/11914-events.json.meta.md',
        'api/issues/fetch-flaky-issues-11800-comments.json.meta.md',
        'api/issues/fetch-flaky-issues-11862-comments.json.meta.md',
        'api/issues/fetch-flaky-issues-11903-comments.json.meta.md',
        'api/issues/fetch-flaky-issues-confirmed-page1.json.meta.md',
        'api/issues/fetch-flaky-issues-observing-page1.json.meta.md',
        'api/pulls/11886-files.json.meta.md',
        'api/pulls/11919-files.json.meta.md',
        'api/pulls/11920-files.json.meta.md',
      ];

      for (const relativePath of realCheckableFixtures) {
        const text = readFixture(relativePath);
        const result = parseMetaSource(text);
        expect(result.kind).toBe('real-checkable');
        if (result.kind === 'real-checkable') {
          expect(result.path).toMatch(/^repos\/growilabs\/growi\//);
        }
      }
    });
  });

  describe('synthetic — `# Source` begins with **Synthetic.**', () => {
    it('classifies a plain synthetic fixture', () => {
      const text = readFixture(
        'api/issues/synthetic-no-date-issue.json.meta.md',
      );
      expect(parseMetaSource(text)).toEqual({ kind: 'synthetic' });
    });

    it('classifies a synthetic fixture whose text embeds an unrelated gh api -X GET command (not repos/growilabs/growi/...)', () => {
      const text = readFixture(
        'api/issues/synthetic-duplicate-sha-repro-result.slurp.json.meta.md',
      );
      expect(parseMetaSource(text)).toEqual({ kind: 'synthetic' });
    });

    it('classifies a synthetic fixture built by editing a real response', () => {
      const text = readFixture(
        'api/issues/synthetic-no-labeled-event-11823-events.json.meta.md',
      );
      expect(parseMetaSource(text)).toEqual({ kind: 'synthetic' });
    });
  });

  describe('unrecognized — does not match the typical form and is not synthetic', () => {
    it('classifies a real gh api -X GET command that carries a -q filter', () => {
      const text = readFixture('lockfile/11886-pnpm-lock.patch.meta.md');
      const result = parseMetaSource(text);
      expect(result.kind).toBe('unrecognized');
    });

    it('classifies a derived (non-API) fixture with no gh api command', () => {
      const text = readFixture(
        'lockfile/11886-extracted-package-names.json.meta.md',
      );
      const result = parseMetaSource(text);
      expect(result.kind).toBe('unrecognized');
    });

    it('classifies a constructed fixture with no gh api command', () => {
      const text = readFixture(
        'api/commits/constructed-empty-pulls.json.meta.md',
      );
      const result = parseMetaSource(text);
      expect(result.kind).toBe('unrecognized');
    });

    it('classifies the api/dashboard/ alternate heading format (# `<filename>` instead of # Source)', () => {
      const text = readFixture('api/dashboard/11720-body.md.meta.md');
      const result = parseMetaSource(text);
      expect(result.kind).toBe('unrecognized');
    });

    it('classifies a real GET command that omits the literal -X GET flag', () => {
      const text = readFixture(
        'api/check-runs/0d1a319a-check-runs.json.meta.md',
      );
      const result = parseMetaSource(text);
      expect(result.kind).toBe('unrecognized');
    });

    it('carries a non-empty reason', () => {
      const text = readFixture(
        'api/commits/constructed-empty-pulls.json.meta.md',
      );
      const result = parseMetaSource(text);
      if (result.kind === 'unrecognized') {
        expect(result.reason.length).toBeGreaterThan(0);
      } else {
        throw new Error('expected unrecognized');
      }
    });
  });

  describe('edge cases', () => {
    it('never throws on empty input', () => {
      expect(() => parseMetaSource('')).not.toThrow();
      expect(parseMetaSource('').kind).toBe('unrecognized');
    });

    it('never throws on arbitrary unrelated text', () => {
      expect(() =>
        parseMetaSource('# Not a meta file\n\nJust prose.'),
      ).not.toThrow();
    });
  });
});
