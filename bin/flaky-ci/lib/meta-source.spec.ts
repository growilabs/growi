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
        path: 'commits/0d1a319a106b2a791e883170782e856f88b0e178/pulls',
        params: {},
        paginate: false,
      });
    });

    it('classifies a path with --paginate (comments)', () => {
      const text = readFixture('api/issues/11821-comments.json.meta.md');
      expect(parseMetaSource(text)).toEqual({
        kind: 'real-checkable',
        path: 'issues/11821/comments',
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
        path: 'issues',
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
        path: 'pulls/11919/files',
        params: {},
        paginate: true,
      });
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
