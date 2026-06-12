import {
  type BulkExportMarkdownRenderer,
  createBulkExportMarkdownRenderer,
} from './bulk-export-markdown-renderer';

/** A representative shared-stylesheet href passed to renderToHtml in tests. */
const CSS_HREF = '_bulk-export.css';

describe('BulkExportMarkdownRenderer', () => {
  let renderer: BulkExportMarkdownRenderer;

  beforeAll(() => {
    renderer = createBulkExportMarkdownRenderer(__dirname);
  });

  describe('GFM table rendering (Requirement 1.1)', () => {
    it('renders GFM table as structured <table> with <thead> and <tbody>', async () => {
      const md = `| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('<table');
      expect(html).toContain('<thead');
      expect(html).toContain('<tbody');
      expect(html).toContain('<th');
      expect(html).toContain('Alice');
    });

    // Requirements 1.1, 2.1: bare <table> has no borders in the design system;
    // the Bootstrap `table table-bordered` classes (which the web renderer adds
    // via its add-class plugin) supply the .table/.table-bordered styling that is
    // present in the precompiled CSS. Without the classes, tables render unstyled.
    it('adds Bootstrap "table table-bordered" classes so design-system table styling applies', async () => {
      const md = `| Name | Age |\n|------|-----|\n| Alice | 30 |`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      const tableTag = html.match(/<table[^>]*>/)?.[0] ?? '';
      expect(tableTag).toMatch(/class="[^"]*\btable\b[^"]*"/);
      expect(tableTag).toMatch(/class="[^"]*\btable-bordered\b[^"]*"/);
    });
  });

  describe('GitHub alert rendering (Requirement 1.2)', () => {
    it('renders GitHub alert as <blockquote>', async () => {
      const md = `> [!NOTE]\n> This is a note.`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('<blockquote');
      expect(html).toContain('This is a note');
    });
  });

  describe('Math formula rendering (Requirement 1.3)', () => {
    it('renders inline math $x$ as KaTeX markup', async () => {
      const md = `Inline: $x^2 + y^2 = z^2$`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toMatch(/class="katex/);
    });

    it('renders display math $$...$$ as KaTeX markup', async () => {
      const md = `$$\nE = mc^2\n$$`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toMatch(/class="katex/);
    });
  });

  describe('Heading ID generation (Requirement 1.4)', () => {
    it('adds unique id attributes to headings', async () => {
      const md = `# Main Title\n## Section One\n### Subsection`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toMatch(/<h1[^>]+id=/);
      expect(html).toMatch(/<h2[^>]+id=/);
      expect(html).toMatch(/<h3[^>]+id=/);
    });
  });

  describe('Frontmatter handling (Requirement 1.5)', () => {
    it('does not expose frontmatter in output body', async () => {
      const md = `---\ntitle: My Page\nauthor: Alice\n---\n# Content\nBody text here.`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).not.toContain('title: My Page');
      expect(html).not.toContain('author: Alice');
      expect(html).toContain('Body text here');
    });
  });

  // Requirements 4.1, 4.2, 4.3: sanitize and safety behaviour
  describe('sanitize and safety behavior', () => {
    // Requirement 4.3: <script> tags must be stripped entirely
    it('removes <script> tags from output', async () => {
      const md = `Hello\n\n<script>alert("xss")</script>\n\nWorld`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert("xss")');
    });

    // Requirement 4.3: inline event handlers must be stripped
    it('removes inline event handlers (onclick etc) from output', async () => {
      const md = `<p onclick="evil()">Click me</p>`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).not.toContain('onclick');
      expect(html).toContain('Click me'); // text content preserved, handler stripped
    });

    // Requirement 4.2: raw HTML in markdown is sanitized, not passed through verbatim
    it('sanitizes raw HTML embedded in markdown (no unsanitized passthrough)', async () => {
      const md = `Normal text\n\n<script src="evil.js"></script>\n\nMore text`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).not.toContain('<script');
    });

    // Requirement 4.1: allowlist passes in-scope GFM table elements
    it('preserves table elements in output (allowlist covers tables)', async () => {
      const md = `| A | B |\n|---|---|\n| 1 | 2 |`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('<table');
      expect(html).toContain('<td');
    });

    // Requirement 4.1: rehype-slug adds id attributes on headings; allowlist must permit id.
    // hast-util-sanitize's defaultSchema prefixes id values with "user-content-" for safety,
    // so the observable output is id="user-content-<slug>".
    it('preserves id attributes on headings (allowlist covers id attr)', async () => {
      const md = `# Test Heading`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      // id attribute is preserved (with the user-content- prefix added by hast-util-sanitize)
      expect(html).toMatch(/id="user-content-test-heading"/);
    });
  });

  // Requirement 3.1: graceful degradation of unsupported syntax
  describe('graceful degradation of unsupported syntax (Requirement 3.1)', () => {
    // Container directives (:::note etc.) have no callout in this pipeline, so remark-directive
    // parses them but they degrade to a plain block that preserves the inner text (改訂 5).
    // The renderer must not throw and must expose the directive's inner text in a readable form.
    it('does not throw for a :::note directive and preserves inner text', async () => {
      const md = `:::note\nThis is a note message.\n:::`;
      // Must resolve (not reject).
      const html = await renderer.renderToHtml(md, CSS_HREF);
      // The inner content must appear somewhere in readable form.
      expect(html).toContain('This is a note message');
    });

    it('does not throw for a :::warning directive and preserves inner text', async () => {
      const md = `:::warning\nDanger ahead.\n:::`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('Danger ahead');
    });

    it('does not throw for a :::tip directive with a label and preserves inner text', async () => {
      const md = `:::tip Pro Tip\nUse keyboard shortcuts.\n:::`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('Use keyboard shortcuts');
    });

    // drawio fenced code blocks have lang="drawio". Without a drawio plugin the renderer
    // must not throw and must output a <code> or <pre> block containing the raw drawio source.
    it('does not throw for a drawio fenced code block and outputs a code/pre block', async () => {
      const md =
        '```drawio\n<mxGraph><root><mxCell id="0"/></root></mxGraph>\n```';
      const html = await renderer.renderToHtml(md, CSS_HREF);
      // Must contain <code> or <pre> — the raw source is rendered as a code block.
      expect(html).toMatch(/<(pre|code)/);
    });

    it('does not throw for a plantuml fenced code block and outputs a code/pre block', async () => {
      const md = '```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```';
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toMatch(/<(pre|code)/);
    });

    // A document mixing unsupported syntax with standard Markdown must not lose the
    // standard content — both the directive fallback and the table must appear.
    it('renders standard Markdown alongside unsupported directives without data loss', async () => {
      const md = [
        '# My Page',
        '',
        ':::note',
        'Inline note.',
        ':::',
        '',
        '| Col A | Col B |',
        '|-------|-------|',
        '| 1     | 2     |',
      ].join('\n');
      const html = await renderer.renderToHtml(md, CSS_HREF);
      // Standard elements must be present.
      expect(html).toContain('<table');
      expect(html).toMatch(/<h1[^>]+id=/);
      // Inner text of the directive must be preserved.
      expect(html).toContain('Inline note');
    });
  });

  // 改訂 5: React-free plugin adoption (emoji / xsv-to-table / remark-directive + echo-directive)
  // Emoji shortcodes are converted to native emoji glyphs (Requirement 1.7).
  describe('emoji shortcode rendering (Requirement 1.7)', () => {
    it('converts known emoji shortcodes to native emoji glyphs', async () => {
      const md = `I am happy :smile: and :+1:`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('😄');
      expect(html).toContain('👍');
      // The literal shortcode syntax must not remain.
      expect(html).not.toContain(':smile:');
    });

    it('leaves unknown shortcodes untouched (no data loss, no throw)', async () => {
      const md = `unknown :notarealemoji: here`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain(':notarealemoji:');
    });
  });

  // CSV/TSV code blocks are converted to structured tables (Requirement 1.8).
  describe('CSV/TSV code block rendering (Requirement 1.8)', () => {
    it('renders a csv-h fenced block as a <table> with header and data cells', async () => {
      const md = '```csv-h\nName,Age\nAlice,30\nBob,25\n```';
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('<table');
      // Header row from csv-h.
      expect(html).toMatch(/<th[^>]*>Name<\/th>/);
      // Data cells.
      expect(html).toContain('Alice');
      expect(html).toContain('25');
      // The table inherits the Bootstrap classes from add-class.
      const tableTag = html.match(/<table[^>]*>/)?.[0] ?? '';
      expect(tableTag).toMatch(/class="[^"]*\btable-bordered\b[^"]*"/);
    });

    it('renders a tsv-h fenced block as a <table>', async () => {
      const md = '```tsv-h\nA\tB\n1\t2\n```';
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('<table');
      expect(html).toMatch(/<th[^>]*>A<\/th>/);
    });
  });

  // text/leaf directives degrade to readable text without leaking the {...} attribute
  // syntax (Requirement 3.1a). echo-directive handles text/leaf (container is callout's
  // domain and stays a plain text-preserving block).
  describe('directive readable-text degradation (Requirement 3.1a)', () => {
    it('renders a text directive as readable text and does not leak the {attr} syntax', async () => {
      const md = `see :abbr[HTML]{title="HyperText Markup Language"} now`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('HTML');
      // The raw attribute syntax must not appear as text.
      expect(html).not.toContain('{title=');
      expect(html).not.toContain('{title="');
    });

    it('renders a leaf directive as readable text and does not leak the {#id} syntax', async () => {
      const md = `::youtube[My Video]{#vid123}`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('My Video');
      expect(html).not.toContain('{#vid123');
    });

    // Requirement 4.3: a dangerous attribute supplied via directive syntax must not
    // survive as a live HTML attribute (echo-directive transcribes it, sanitize strips it).
    it('strips dangerous attributes supplied via directive attribute syntax', async () => {
      const md = `:danger{onclick="evil()"}[text]`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('evil()');
    });
  });

  // Requirement 4.1: single-source allowlist — observable behaviour matches recommended-whitelist.ts
  describe('sanitize allowlist provenance (Requirement 4.1)', () => {
    // details/summary are in defaultSchema.tagNames (included via recommended-whitelist's spread)
    // This confirms the allowlist is effectively applied from the single source of truth
    it('preserves <details>/<summary> elements (present in recommended-whitelist via defaultSchema)', async () => {
      const md = `<details><summary>Expand</summary>Content here</details>`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).toContain('<details');
      expect(html).toContain('<summary');
      expect(html).toContain('Content here');
    });

    // Dangerous elements not in the allowlist are stripped regardless
    it('strips <object> tags not in the allowlist', async () => {
      const md = `<object data="malicious.swf" type="application/x-shockwave-flash"></object>`;
      const html = await renderer.renderToHtml(md, CSS_HREF);
      expect(html).not.toContain('<object');
    });
  });

  // Requirements 2.1, 2.2: the shared stylesheet is linked (not inlined) so the
  // CSS is not duplicated into every page. The .wiki container styles the content.
  describe('shared-stylesheet linking and .wiki wrapping (Requirements 2.1, 2.2)', () => {
    it('links the shared stylesheet at the given href instead of inlining a <style> block', async () => {
      const html = await renderer.renderToHtml(
        '# Hello',
        '../_bulk-export.css',
      );
      expect(html).toContain(
        '<link rel="stylesheet" href="../_bulk-export.css">',
      );
      // No inline <style> — the CSS lives in the shared file, not in each page.
      expect(html).not.toContain('<style>');
    });

    it('wraps the rendered content in a .wiki container', async () => {
      const html = await renderer.renderToHtml('# Hello', CSS_HREF);
      expect(html).toContain('<div class="wiki">');
      expect(html).toContain('</div>');
    });

    it('getCss() returns the shared CSS to be written once per job (non-empty)', () => {
      const css = renderer.getCss();
      expect(typeof css).toBe('string');
      expect(css.length).toBeGreaterThan(0);
    });
  });
});
