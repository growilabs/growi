import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it, vi } from 'vitest';

import { remarkPlugin } from './plantuml';

vi.mock('@akebifiky/remark-simple-plantuml', () => ({
  // The real plugin would convert the 'code' node into an 'image' node.
  // Stubbed as a no-op so the test can inspect the 'code' node value
  // exactly as it is handed off for PlantUML rendering.
  default: vi.fn(() => vi.fn()),
}));

describe('remarkPlugin', () => {
  it.each([
    ['light', false],
    ['dark', true],
  ])('does not prepend theme metadata to the plantuml source in %s mode', (_modeLabel, isDarkMode) => {
    const userDiagram = 'A -> B: hello';
    const markdown = ['```plantuml', userDiagram, '```', ''].join('\n');

    const processor = unified().use(remarkParse).use(remarkPlugin, {
      plantumlUri: 'https://plantuml.example.com',
      isDarkMode,
    });

    const tree = processor.parse(markdown);
    processor.runSync(tree);

    let codeValue: string | undefined;
    visit(tree, 'code', (node) => {
      codeValue = node.value;
    });

    // The theme is still prepended, but must never carry a YAML front matter
    // block into the source sent to the PlantUML server.
    expect(codeValue).not.toMatch(/^\s*---/);
    expect(codeValue).not.toContain('---\n');
    expect(codeValue).toContain(userDiagram);
  });
});
