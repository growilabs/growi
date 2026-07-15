import { describe, expect, it } from 'vitest';

import {
  buildErrorMarkdown,
  buildPageMarkdown,
  type FooterLink,
  type PageMarkdownInput,
} from './build-page-markdown';
import { MARKDOWN_FOOTER_MAX_LINKS } from './constants';

const PARENT_LINK: FooterLink = {
  title: 'foo',
  mdUrl: '/507f1f77bcf86cd799439001.md',
};

const SIBLING_LINK: FooterLink = {
  title: 'sibling-a',
  mdUrl: '/507f1f77bcf86cd799439004.md',
};

const CHILD_LINKS: FooterLink[] = [
  { title: 'child-a', mdUrl: '/507f1f77bcf86cd799439002.md' },
  { title: 'child-b', mdUrl: '/507f1f77bcf86cd799439003.md' },
];

const baseInput: PageMarkdownInput = {
  path: '/foo/bar',
  origin: 'https://example.com',
  permalinkUrl: 'https://example.com/507f1f77bcf86cd799439011',
  canonicalUrl: 'https://example.com/foo/bar',
  body: 'Hello **world**',
  isEmpty: false,
  parent: PARENT_LINK,
  children: CHILD_LINKS,
  childrenTotal: 2,
  descendantCount: 5,
  siblings: [SIBLING_LINK],
  siblingsTotal: 1,
  pageListApiHint: 'GET /_api/v3/pages/list?path=/foo/bar',
  updatedAt: '2026-07-01T00:00:00.000Z',
  updatedByUsername: 'alice',
};

describe('buildPageMarkdown', () => {
  it('renders the body verbatim, followed by the footer (4.1)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result.startsWith(baseInput.body)).toBe(true);
    const bodyIndex = result.indexOf(baseInput.body);
    const footerIndex = result.indexOf('Page Navigation');
    expect(footerIndex).toBeGreaterThan(bodyIndex);
  });

  it('never transforms the body content itself, even when it contains its own Markdown', () => {
    const bodyWithMarkdown =
      '# Title\n\n- item1\n- item2\n\n```js\nconst x = 1;\n```';
    const result = buildPageMarkdown({ ...baseInput, body: bodyWithMarkdown });

    expect(result).toContain(bodyWithMarkdown);
  });

  it('includes both the canonical URL and the permalink URL (4.1)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).toContain(baseInput.canonicalUrl);
    expect(result).toContain(baseInput.permalinkUrl);
  });

  it('renders the parent link when a parent is present (4.2)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).toContain(`[${PARENT_LINK.title}](${PARENT_LINK.mdUrl})`);
  });

  it('omits the parent line, and the entire siblings section, when parent is null (root, 4.8)', () => {
    const rootInput: PageMarkdownInput = { ...baseInput, parent: null };
    const result = buildPageMarkdown(rootInput);

    expect(result).not.toContain('Parent:');
    expect(result).not.toContain('Siblings');
    expect(result).not.toContain(SIBLING_LINK.mdUrl);
  });

  it('still renders children at the root (root only omits parent/siblings, not children)', () => {
    const rootInput: PageMarkdownInput = { ...baseInput, parent: null };
    const result = buildPageMarkdown(rootInput);

    for (const child of CHILD_LINKS) {
      expect(result).toContain(`[${child.title}](${child.mdUrl})`);
    }
  });

  it('renders child links and states the exact childrenTotal (4.3)', () => {
    const result = buildPageMarkdown(baseInput);

    for (const child of CHILD_LINKS) {
      expect(result).toContain(`[${child.title}](${child.mdUrl})`);
    }
    expect(result).toContain(`${baseInput.childrenTotal} total`);
  });

  it('states descendantCount as a number separate and distinguishable from childrenTotal (4.3)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).toContain(`Total descendants: ${baseInput.descendantCount}`);
    expect(result).toContain(`${baseInput.childrenTotal} total`);
    // The two figures must both be present and must not collapse into one number.
    expect(baseInput.childrenTotal).not.toBe(baseInput.descendantCount);
  });

  it('renders sibling links when present (4.4)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).toContain(`[${SIBLING_LINK.title}](${SIBLING_LINK.mdUrl})`);
  });

  it('always includes the last-updated datetime and updater username (4.5)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).toContain(baseInput.updatedAt);
    expect(result).toContain(baseInput.updatedByUsername);
  });

  it('always includes the page-list API hint, even when there are zero children (4.6)', () => {
    const noChildrenInput: PageMarkdownInput = {
      ...baseInput,
      children: [],
      childrenTotal: 0,
      descendantCount: 0,
    };
    const result = buildPageMarkdown(noChildrenInput);

    expect(result).toContain(baseInput.pageListApiHint);
  });

  it('always includes the page-list API hint alongside a full (non-truncated) children list', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).toContain(baseInput.pageListApiHint);
  });

  it('states the total and the omitted remainder when children exceed the footer limit, instead of silently truncating (4.7)', () => {
    const shown: FooterLink[] = Array.from(
      { length: MARKDOWN_FOOTER_MAX_LINKS },
      (_, i) => ({ title: `child-${i}`, mdUrl: `/child-${i}.md` }),
    );
    const total = MARKDOWN_FOOTER_MAX_LINKS + 7;
    const result = buildPageMarkdown({
      ...baseInput,
      children: shown,
      childrenTotal: total,
    });

    expect(result).toContain(`${total}`);
    expect(result).toContain('7 more');
  });

  it('states the total and the omitted remainder when siblings exceed the footer limit, instead of silently truncating (4.7)', () => {
    const shown: FooterLink[] = Array.from(
      { length: MARKDOWN_FOOTER_MAX_LINKS },
      (_, i) => ({ title: `sibling-${i}`, mdUrl: `/sibling-${i}.md` }),
    );
    const total = MARKDOWN_FOOTER_MAX_LINKS + 3;
    const result = buildPageMarkdown({
      ...baseInput,
      siblings: shown,
      siblingsTotal: total,
    });

    expect(result).toContain(`${total}`);
    expect(result).toContain('3 more');
  });

  it('does not state a remainder when the shown count exactly matches the total (no false truncation notice)', () => {
    const result = buildPageMarkdown(baseInput);

    expect(result).not.toContain('more not shown');
  });

  it('shows the page path and a one-sentence "no content" notice instead of the body, plus the full footer, for an empty container page (5.1, 5.3)', () => {
    const emptyInput: PageMarkdownInput = {
      ...baseInput,
      isEmpty: true,
      body: '',
    };
    const result = buildPageMarkdown(emptyInput);

    expect(result).toContain(baseInput.path);
    expect(result.toLowerCase()).toMatch(/no content/);
    // footer elements must still be present
    expect(result).toContain(baseInput.canonicalUrl);
    expect(result).toContain(baseInput.permalinkUrl);
    expect(result).toContain(`[${PARENT_LINK.title}](${PARENT_LINK.mdUrl})`);
    expect(result).toContain(baseInput.pageListApiHint);
  });

  it('renders an empty body verbatim (no "no content" notice) plus the footer, for a non-empty page whose revision body is the empty string (5.2)', () => {
    const emptyBodyInput: PageMarkdownInput = {
      ...baseInput,
      isEmpty: false,
      body: '',
    };
    const result = buildPageMarkdown(emptyBodyInput);

    expect(result.toLowerCase()).not.toMatch(/no content/);
    expect(result).toContain(baseInput.canonicalUrl);
    expect(result).toContain(baseInput.permalinkUrl);
  });
});

describe('buildErrorMarkdown', () => {
  it('returns Markdown guidance suggesting authenticated access or the GROWI MCP for a forbidden (403) response, without leaking page content (3.5)', () => {
    const result = buildErrorMarkdown('forbidden');

    expect(result).toMatch(/authenticat/i);
    expect(result).toMatch(/MCP/);
    expect(result).not.toContain(baseInput.body);
    expect(result).not.toContain(baseInput.path);
  });

  it('returns Markdown guidance suggesting authenticated access or the GROWI MCP for a not-found (404) response, without leaking page content (3.5)', () => {
    const result = buildErrorMarkdown('notFound');

    expect(result).toMatch(/authenticat/i);
    expect(result).toMatch(/MCP/);
    expect(result).not.toContain(baseInput.body);
    expect(result).not.toContain(baseInput.path);
  });

  it('produces distinguishable bodies for forbidden vs notFound, without asserting existence in the notFound case (3.5)', () => {
    const forbidden = buildErrorMarkdown('forbidden');
    const notFound = buildErrorMarkdown('notFound');

    expect(forbidden).not.toBe(notFound);
    expect(forbidden.toLowerCase()).toContain('permission');
    expect(notFound.toLowerCase()).toMatch(/not exist|not found/);
  });
});

describe('MARKDOWN_FOOTER_MAX_LINKS', () => {
  it('is exported with the documented Phase 1 default of 50', () => {
    expect(MARKDOWN_FOOTER_MAX_LINKS).toBe(50);
  });
});
