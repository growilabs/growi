import {
  type BulkExportMarkdownRenderer,
  createBulkExportMarkdownRenderer,
} from './bulk-export-markdown-renderer';

describe('BulkExportMarkdownRenderer', () => {
  let renderer: BulkExportMarkdownRenderer;

  beforeAll(async () => {
    renderer = createBulkExportMarkdownRenderer(__dirname);
  });

  describe('GFM table rendering (Requirement 1.1)', () => {
    it('renders GFM table as structured <table> with <thead> and <tbody>', async () => {
      const md = `| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |`;
      const html = await renderer.renderToHtml(md);
      expect(html).toContain('<table');
      expect(html).toContain('<thead');
      expect(html).toContain('<tbody');
      expect(html).toContain('<th');
      expect(html).toContain('Alice');
    });
  });

  describe('GitHub alert rendering (Requirement 1.2)', () => {
    it('renders GitHub alert as <blockquote>', async () => {
      const md = `> [!NOTE]\n> This is a note.`;
      const html = await renderer.renderToHtml(md);
      expect(html).toContain('<blockquote');
      expect(html).toContain('This is a note');
    });
  });

  describe('Math formula rendering (Requirement 1.3)', () => {
    it('renders inline math $x$ as KaTeX markup', async () => {
      const md = `Inline: $x^2 + y^2 = z^2$`;
      const html = await renderer.renderToHtml(md);
      expect(html).toMatch(/class="katex/);
    });

    it('renders display math $$...$$ as KaTeX markup', async () => {
      const md = `$$\nE = mc^2\n$$`;
      const html = await renderer.renderToHtml(md);
      expect(html).toMatch(/class="katex/);
    });
  });

  describe('Heading ID generation (Requirement 1.4)', () => {
    it('adds unique id attributes to headings', async () => {
      const md = `# Main Title\n## Section One\n### Subsection`;
      const html = await renderer.renderToHtml(md);
      expect(html).toMatch(/<h1[^>]+id=/);
      expect(html).toMatch(/<h2[^>]+id=/);
      expect(html).toMatch(/<h3[^>]+id=/);
    });
  });

  describe('Frontmatter handling (Requirement 1.5)', () => {
    it('does not expose frontmatter in output body', async () => {
      const md = `---\ntitle: My Page\nauthor: Alice\n---\n# Content\nBody text here.`;
      const html = await renderer.renderToHtml(md);
      expect(html).not.toContain('title: My Page');
      expect(html).not.toContain('author: Alice');
      expect(html).toContain('Body text here');
    });
  });
});
