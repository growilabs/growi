import {
  isPermalink,
  isUserPage,
} from '@growi/core/dist/utils/page-path-utils';

import { isPageRoute } from '../utils/hash-page-path';
import { matchPathPattern } from '../utils/path-pattern';
import type { PathRule, RedactPattern, RequestPath } from './types';

const MARKDOWN_SUFFIX = '.md';

const STATIC_PREFIXES: readonly string[] = [
  '/_next/',
  '/_drawio-assets/',
  '/uploads/',
  '/vault.git/',
];
// /vault.git is listed here as well as under STATIC_PREFIXES because app.use matches
// only the mount path itself and paths below it, not page names such as /vault.gitignore
const STATIC_FILES: readonly string[] = [
  '/favicon.ico',
  '/favicon.svg',
  '/vault.git',
];
// Only these directories may also hold page names, so they need the extension check
const STATIC_DIRS_WITH_PAGE_FALLBACK: readonly string[] = [
  '/static/',
  '/images/',
];
const STATIC_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'css',
  'js',
  'mjs',
  'map',
  'json',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
]);

const SECRET_PATH_PATTERNS: readonly RedactPattern[] = [
  { pattern: '/share/:linkId', params: ['linkId'] },
  { pattern: '/forgot-password/:token', params: ['token'] },
  { pattern: '/user-activation/:token', params: ['token'] },
];

// The user group :id is an ObjectId, so only the share link id and username are redacted
const API_PATH_PATTERNS: readonly RedactPattern[] = [
  { pattern: '/_api/v3/share-links/:id', params: ['id'] },
  {
    pattern: '/_api/v3/user-groups/:id/users/:username',
    params: ['username'],
  },
];

const matchesAnyPattern = (
  patterns: readonly RedactPattern[],
  raw: string,
): boolean => patterns.some((p) => matchPathPattern(p.pattern, raw) != null);

const hasStaticExtension = (raw: string): boolean => {
  const lastSegment = raw.slice(raw.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  return (
    dot > 0 && STATIC_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase())
  );
};

const isStaticFile = ({ raw }: RequestPath): boolean =>
  STATIC_PREFIXES.some((prefix) => raw.startsWith(prefix)) ||
  STATIC_FILES.includes(raw) ||
  (STATIC_DIRS_WITH_PAGE_FALLBACK.some((dir) => raw.startsWith(dir)) &&
    hasStaticExtension(raw));

const isPageOrUserPage = (decoded: string): boolean =>
  isUserPage(decoded) || isPageRoute(decoded);

const isKeptPage = ({ decoded }: RequestPath): boolean => {
  if (decoded === '/' || decoded === '/user') {
    return true;
  }
  const withoutMarkdown = decoded.endsWith(MARKDOWN_SUFFIX)
    ? decoded.slice(0, -MARKDOWN_SUFFIX.length)
    : decoded;
  return isPermalink(withoutMarkdown);
};

const isMarkdownPage = ({ decoded }: RequestPath): boolean =>
  decoded.endsWith(MARKDOWN_SUFFIX) &&
  isPageOrUserPage(decoded.slice(0, -MARKDOWN_SUFFIX.length));

const isTrashPage = ({ decoded }: RequestPath): boolean =>
  decoded.startsWith('/trash/') && decoded.length > '/trash/'.length;

/** Evaluated top to bottom; the first matching rule is the only one applied */
export const PATH_RULES: readonly PathRule[] = [
  {
    id: 'next-data',
    matches: ({ raw }) => raw.startsWith('/_next/data/'),
    action: { kind: 'unwrap-next-data' },
  },
  {
    id: 'static-files',
    matches: isStaticFile,
    action: { kind: 'keep' },
  },
  {
    id: 'secret-path-segments',
    matches: ({ raw }) => matchesAnyPattern(SECRET_PATH_PATTERNS, raw),
    action: { kind: 'redact-pattern-params', patterns: SECRET_PATH_PATTERNS },
  },
  {
    id: 'api-path-segments',
    matches: ({ raw }) => matchesAnyPattern(API_PATH_PATTERNS, raw),
    action: { kind: 'redact-pattern-params', patterns: API_PATH_PATTERNS },
  },
  {
    id: 'kept-pages',
    matches: isKeptPage,
    action: { kind: 'keep' },
  },
  {
    id: 'page-markdown',
    matches: isMarkdownPage,
    action: {
      kind: 'hash-page-path-with-suffix',
      suffix: MARKDOWN_SUFFIX,
    },
  },
  {
    id: 'trash-page',
    matches: isTrashPage,
    action: { kind: 'hash-page-path-under-prefix', prefix: '/trash' },
  },
  {
    id: 'page-view',
    matches: ({ decoded }) => isPageOrUserPage(decoded),
    action: { kind: 'hash-page-path' },
  },
];
