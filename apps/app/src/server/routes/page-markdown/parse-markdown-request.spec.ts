import { describe, expect, it } from 'vitest';

import {
  type MarkdownRequestIntent,
  parseMarkdownRequest,
} from './parse-markdown-request';

// A syntactically valid 24-hex ObjectId, reused across permalink-related cases.
const VALID_OBJECT_ID = '507f1f77bcf86cd799439011';

type Case = {
  name: string;
  reqPath: string;
  accept: string | undefined;
  formatQuery: string | undefined;
  expected: MarkdownRequestIntent;
};

describe('parseMarkdownRequest', () => {
  describe('not a markdown request -> none', () => {
    const cases: Case[] = [
      {
        name: 'plain path without .md suffix, no Accept, no ?format',
        reqPath: '/foo/bar',
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'none' },
      },
      {
        name: 'bare permalink path without .md suffix or explicit intent is a normal page view',
        reqPath: `/${VALID_OBJECT_ID}`,
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'none' },
      },
      {
        name: '.mdx suffix is not treated as a markdown request',
        reqPath: '/foo/file.mdx',
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'none' },
      },
      {
        name: 'Accept: */* (wildcard) must not be treated as an explicit markdown request',
        reqPath: '/foo/bar',
        accept: '*/*',
        formatQuery: undefined,
        expected: { kind: 'none' },
      },
      {
        name: 'Accept: text/* (wildcard subtype) must not be treated as an explicit markdown request',
        reqPath: '/foo/bar',
        accept: 'text/*',
        formatQuery: undefined,
        expected: { kind: 'none' },
      },
      {
        name: '?format=html (not "md") does not trigger a markdown request',
        reqPath: '/foo/bar',
        accept: undefined,
        formatQuery: 'html',
        expected: { kind: 'none' },
      },
      {
        name: 'empty Accept header behaves like no Accept header',
        reqPath: '/foo/bar',
        accept: '',
        formatQuery: undefined,
        expected: { kind: 'none' },
      },
    ];

    it.each(cases)('$name', ({ reqPath, accept, formatQuery, expected }) => {
      expect(parseMarkdownRequest(reqPath, accept, formatQuery)).toStrictEqual(
        expected,
      );
    });
  });

  describe('.md suffix (sugar, explicit=false) -> path or permalink, original path preserved', () => {
    const cases: Case[] = [
      {
        name: '.md suffix on an ordinary path yields kind=path with the ORIGINAL (unstripped) path',
        reqPath: '/foo/README.md',
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/README.md', explicit: false },
      },
      {
        name: '.md.md (double suffix) yields kind=path with the path fully unchanged',
        reqPath: '/foo/README.md.md',
        accept: undefined,
        formatQuery: undefined,
        expected: {
          kind: 'path',
          path: '/foo/README.md.md',
          explicit: false,
        },
      },
      {
        name: '.md suffix on a permalink (/{24hex}.md) yields kind=permalink with the extracted pageId',
        reqPath: `/${VALID_OBJECT_ID}.md`,
        accept: undefined,
        formatQuery: undefined,
        expected: {
          kind: 'permalink',
          pageId: VALID_OBJECT_ID,
          explicit: false,
        },
      },
    ];

    it.each(cases)('$name', ({ reqPath, accept, formatQuery, expected }) => {
      expect(parseMarkdownRequest(reqPath, accept, formatQuery)).toStrictEqual(
        expected,
      );
    });
  });

  describe('explicit intent (Accept: text/markdown or ?format=md) -> never strips trailing .md', () => {
    const cases: Case[] = [
      {
        name: 'Accept: text/markdown (exact) marks the request explicit',
        reqPath: '/foo/bar',
        accept: 'text/markdown',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/bar', explicit: true },
      },
      {
        name: 'Accept header with quality parameter (;q=0.9) still matches explicitly',
        reqPath: '/foo/bar',
        accept: 'text/markdown;q=0.9',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/bar', explicit: true },
      },
      {
        name: 'comma-separated Accept list containing text/markdown matches explicitly',
        reqPath: '/foo/bar',
        accept: 'text/html, text/markdown',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/bar', explicit: true },
      },
      {
        name: 'messy comma-separated Accept list with extra whitespace and quality params still matches',
        reqPath: '/foo/bar',
        accept: 'text/html , text/markdown ; q=0.5 , application/json',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/bar', explicit: true },
      },
      {
        name: 'Accept media type comparison is case-insensitive',
        reqPath: '/foo/bar',
        accept: 'Text/Markdown',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/bar', explicit: true },
      },
      {
        name: '?format=md marks the request explicit',
        reqPath: '/foo/bar',
        accept: undefined,
        formatQuery: 'md',
        expected: { kind: 'path', path: '/foo/bar', explicit: true },
      },
      {
        name: 'explicit intent on a bare permalink path yields kind=permalink',
        reqPath: `/${VALID_OBJECT_ID}`,
        accept: 'text/markdown',
        formatQuery: undefined,
        expected: {
          kind: 'permalink',
          pageId: VALID_OBJECT_ID,
          explicit: true,
        },
      },
      {
        name: 'explicit intent does NOT strip a trailing .md suffix from an ordinary path (req 2.4)',
        reqPath: '/foo/README.md',
        accept: 'text/markdown',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/README.md', explicit: true },
      },
      {
        name: '?format=md does not strip a trailing .md suffix from an ordinary path either (req 2.4)',
        reqPath: '/foo/README.md',
        accept: undefined,
        formatQuery: 'md',
        expected: { kind: 'path', path: '/foo/README.md', explicit: true },
      },
      {
        name: 'explicit intent on a permalink carrying the .md sugar suffix resolves as permalink (/{24hex}.md can never be a real page path)',
        reqPath: `/${VALID_OBJECT_ID}.md`,
        accept: 'text/markdown',
        formatQuery: undefined,
        expected: {
          kind: 'permalink',
          pageId: VALID_OBJECT_ID,
          explicit: true,
        },
      },
    ];

    it.each(cases)('$name', ({ reqPath, accept, formatQuery, expected }) => {
      expect(parseMarkdownRequest(reqPath, accept, formatQuery)).toStrictEqual(
        expected,
      );
    });
  });

  describe('percent-encoded request paths are decoded before classification', () => {
    // Express's req.path is NOT percent-decoded (a request for "/foo bar.md"
    // arrives as "/foo%20bar.md"), while GROWI stores page paths decoded.
    // The classifier must therefore return the DECODED page path so the
    // resolver's exact-match DB lookup can succeed.
    const cases: Case[] = [
      {
        name: 'percent-encoded space in a .md-suffixed path is decoded (still-suffixed form preserved)',
        reqPath: '/foo/space%20page.md',
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/space page.md', explicit: false },
      },
      {
        name: 'percent-encoded non-ASCII (Japanese) .md-suffixed path is decoded',
        reqPath: '/%E6%97%A5%E6%9C%AC%E8%AA%9E.md',
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'path', path: '/日本語.md', explicit: false },
      },
      {
        name: 'percent-encoded plain path with explicit Accept is decoded',
        reqPath: '/%E6%97%A5%E6%9C%AC%E8%AA%9E',
        accept: 'text/markdown',
        formatQuery: undefined,
        expected: { kind: 'path', path: '/日本語', explicit: true },
      },
      {
        name: 'malformed percent-escape falls back to the raw path instead of throwing',
        reqPath: '/foo/broken%zz.md',
        accept: undefined,
        formatQuery: undefined,
        expected: { kind: 'path', path: '/foo/broken%zz.md', explicit: false },
      },
    ];

    it.each(cases)('$name', ({ reqPath, accept, formatQuery, expected }) => {
      expect(parseMarkdownRequest(reqPath, accept, formatQuery)).toStrictEqual(
        expected,
      );
    });
  });
});
