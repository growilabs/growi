/**
 * A single navigation link rendered in the Markdown footer (parent, a
 * child, or a sibling): a human-readable title paired with the page's
 * ".md" URL (see ~/utils/page-markdown-url).
 */
export interface FooterLink {
  title: string;
  mdUrl: string;
}

/**
 * Input to buildPageMarkdown. All fields are pre-resolved by the caller
 * (respondWithPageMarkdown) -- this module performs no I/O and knows
 * nothing about Page/Revision models, viewers, or Express.
 */
export interface PageMarkdownInput {
  /** The page's path, e.g. "/foo/bar". Used for the empty-page notice. */
  path: string;
  /** Origin (protocol + host), reserved for callers; not rendered directly. */
  origin: string;
  /** host + "/{pageId}" -- the permalink form (Requirement 4.1). */
  permalinkUrl: string;
  /** host + path -- the "can also be opened via host+path" hint (Requirement 4.1). */
  canonicalUrl: string;
  /** revision.body, verbatim. Empty string for empty pages. */
  body: string;
  /** True when the page has no body content (container page, Requirement 5.1). */
  isEmpty: boolean;
  /** The parent page's footer link, or null at the hierarchy root (Requirement 4.8). */
  parent: FooterLink | null;
  /** Child links, already limited by the caller to at most MARKDOWN_FOOTER_MAX_LINKS. */
  children: FooterLink[];
  /** The exact total number of direct children (may exceed children.length). */
  childrenTotal: number;
  /** The total descendant count -- distinct from childrenTotal (Requirement 4.3). */
  descendantCount: number;
  /** Sibling links (self excluded), already limited by the caller. */
  siblings: FooterLink[];
  /** The exact total number of siblings (may exceed siblings.length). */
  siblingsTotal: number;
  /** Guidance pointing to the existing page-list API for the full listing (Requirement 4.6). */
  pageListApiHint: string;
  /** Last revision update datetime, ISO-8601 or otherwise pre-formatted by the caller. */
  updatedAt: string;
  /** Last updater's username, already passed through serializeUserSecurely by the caller. */
  updatedByUsername: string;
}

const EMPTY_PAGE_NOTICE = 'This page has no content yet.';

// Template literal (not .join) so the initializer stays on the
// route-top-level-guard allowlist (no top-level call expressions).
const ERROR_GUIDANCE = `If you believe this page exists and you have access to it, retry with an
authenticated request (a logged-in session or a Personal Access Token),
or use the GROWI MCP server, which can fetch this page on your behalf
using your own credentials.`;

function renderLinkListItem(link: FooterLink): string {
  return `  - [${link.title}](${link.mdUrl})`;
}

/**
 * Render a count summary line ("N total" or, when the shown list is
 * shorter than the true total, "shown of total (remainder more not
 * shown; ...)") so overflow is always stated explicitly rather than
 * silently truncated (Requirement 4.7).
 */
function renderCountSummary(
  label: string,
  shown: number,
  total: number,
): string {
  if (shown >= total) {
    return `- ${label}: ${total} total`;
  }
  const remaining = total - shown;
  return `- ${label}: ${shown} of ${total} total (${remaining} more not shown; see the page list API below for the full listing)`;
}

function renderChildrenSection(input: PageMarkdownInput): string[] {
  const lines: string[] = [
    renderCountSummary('Children', input.children.length, input.childrenTotal),
  ];
  if (input.children.length > 0) {
    lines.push(...input.children.map(renderLinkListItem));
  }
  lines.push(`- Total descendants: ${input.descendantCount}`);
  return lines;
}

function renderSiblingsSection(input: PageMarkdownInput): string[] {
  const lines: string[] = [
    renderCountSummary('Siblings', input.siblings.length, input.siblingsTotal),
  ];
  if (input.siblings.length > 0) {
    lines.push(...input.siblings.map(renderLinkListItem));
  }
  return lines;
}

function buildFooter(input: PageMarkdownInput): string {
  const lines: string[] = ['## Page Navigation', ''];

  lines.push(`- Canonical URL: ${input.canonicalUrl}`);
  lines.push(`- Permalink: ${input.permalinkUrl}`);

  if (input.parent != null) {
    lines.push(`- Parent: [${input.parent.title}](${input.parent.mdUrl})`);
  }

  lines.push(...renderChildrenSection(input));

  // Root pages have no parent and, by design, omit the siblings section too
  // (siblings are derived from the parent; a root has none to derive from).
  if (input.parent != null) {
    lines.push(...renderSiblingsSection(input));
  }

  lines.push(
    `- Last updated: ${input.updatedAt} by ${input.updatedByUsername}`,
  );
  lines.push(
    `- Full page listing (all children regardless of count): ${input.pageListApiHint}`,
  );

  return lines.join('\n');
}

/**
 * Build the full Markdown document for a page response: the body verbatim
 * (never transformed), followed by a navigation footer with the canonical
 * URL, permalink, parent/children/siblings links, update info, and a
 * page-list API pointer (Requirements 3.5, 4.1-4.8, 5.1-5.3).
 */
export function buildPageMarkdown(input: PageMarkdownInput): string {
  const bodySection = input.isEmpty
    ? `# ${input.path}\n\n${EMPTY_PAGE_NOTICE}`
    : input.body;

  const footer = buildFooter(input);

  return `${bodySection}\n\n---\n\n${footer}\n`;
}

/**
 * Build the short Markdown guidance body returned for 403/404 responses.
 * Never includes any page content (title, path, or body) -- only generic
 * guidance toward authenticated access or the GROWI MCP (Requirement 3.5).
 *
 * The two kinds are deliberately worded differently:
 * - 'forbidden': the page exists but the viewer lacks permission.
 * - 'notFound': the page may not exist, or may exist without permission --
 *   this must NOT assert existence, to avoid leaking that a private page
 *   is present at this path (see design.md "Error Categories").
 */
export function buildErrorMarkdown(kind: 'forbidden' | 'notFound'): string {
  if (kind === 'forbidden') {
    return [
      '# 403 Forbidden',
      '',
      'You do not have permission to view this page.',
      '',
      ERROR_GUIDANCE,
    ].join('\n');
  }

  return [
    '# 404 Not Found',
    '',
    'This page does not exist, or it exists and you do not have permission to view it.',
    '',
    ERROR_GUIDANCE,
  ].join('\n');
}
