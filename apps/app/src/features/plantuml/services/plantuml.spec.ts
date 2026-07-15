import type { Code, Root } from 'mdast';
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
    const codeNode: Code = {
      type: 'code',
      lang: 'plantuml',
      value: userDiagram,
    };
    const tree: Root = { type: 'root', children: [codeNode] };

    const transformer = remarkPlugin({
      plantumlUri: 'https://plantuml.example.com',
      isDarkMode,
    });
    transformer(tree, { data: {} } as Parameters<typeof transformer>[1]);

    // The theme is still prepended, but must never carry a YAML front matter
    // block into the source sent to the PlantUML server.
    expect(codeNode.value).not.toMatch(/^\s*---/);
    expect(codeNode.value).not.toContain('---\n');
    expect(codeNode.value).toContain(userDiagram);
  });
});
