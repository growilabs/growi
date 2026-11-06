import { prepareMermaidSource } from './prepare-mermaid-source';

const diagram = 'flowchart TD\nA[Start] --> B[End]';
const dark = '%%{init: {"theme": "dark"}}%%\n';

describe('prepareMermaidSource', () => {
  it.each([
    diagram,
    `---\nconfig:\n  theme: forest\n---\n${diagram}`,
    `%%{init: {"theme": "forest"}}%%\n${diagram}`,
    `---\nconfig: [\n---\n${diagram}`,
  ])('leaves light-mode source unchanged: %s', (source) => {
    expect(prepareMermaidSource(source, false)).toBe(source);
  });

  it('adds the dark directive before a diagram', () => {
    expect(prepareMermaidSource(diagram, true)).toBe(dark + diagram);
  });

  it('places the injected directive before user directives', () => {
    const source = `%%{init: {"theme": "forest"}}%%\n${diagram}`;
    expect(prepareMermaidSource(source, true)).toBe(dark + source);
  });

  it.each([
    'title: Example',
    '',
    '# config.theme is only a comment\ntitle: "theme: forest"',
    'theme: forest',
    'config:\n  themeVariables:\n    primaryColor: "#abcdef"',
    'config: null',
    '- theme: forest',
  ])('inserts after frontmatter without config.theme: %s', (yaml) => {
    const header = `---\n${yaml}\n---\n`;
    expect(prepareMermaidSource(header + diagram, true)).toBe(
      header + dark + diagram,
    );
  });

  it.each([
    'config:\n  theme: forest',
    'config: {theme: forest}',
    '"config": {"theme": "forest"}',
    'config:\n  theme: default # retain an explicit default',
    'config:\n  theme: null',
    'settings: &settings\n  theme: forest\nconfig: *settings',
  ])('preserves an explicit frontmatter theme: %s', (yaml) => {
    const source = `---\n${yaml}\n---\n${diagram}`;
    expect(prepareMermaidSource(source, true)).toBe(source);
  });

  it.each([
    '\n',
    '\r\n',
    '\r',
  ])('preserves frontmatter line endings: %j', (newline) => {
    const header = ['---', 'title: Example', '---', ''].join(newline);
    expect(prepareMermaidSource(header + diagram, true)).toBe(
      header + dark + diagram,
    );
  });

  it('handles indented frontmatter using Mermaid-compatible de-indentation', () => {
    const header = '  ---\n  title: Example\n  ---\n';
    expect(prepareMermaidSource(header + diagram, true)).toBe(
      header + dark + diagram,
    );
    const themed = `  ---\n  config:\n    theme: forest\n  ---\n${diagram}`;
    expect(prepareMermaidSource(themed, true)).toBe(themed);
  });

  it.each([
    `---\nconfig: [\n---\n${diagram}`,
    `---\nconfig: *missing\n---\n${diagram}`,
    '---\ntitle: Unterminated',
  ])('does not repair malformed frontmatter: %s', (source) => {
    expect(prepareMermaidSource(source, true)).toBe(source);
  });

  it('keeps user directives after the frontmatter and injected directive', () => {
    const header = '---\ntitle: Example\n---\n';
    const userSource = `%%{init: {"theme": "forest"}}%%\n${diagram}`;
    expect(prepareMermaidSource(header + userSource, true)).toBe(
      header + dark + userSource,
    );
  });
});
