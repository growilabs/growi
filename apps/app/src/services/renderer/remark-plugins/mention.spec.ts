import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { remarkPlugin, sanitizeOption } from './mention';

type MentionNode = {
  type: 'mention';
  data: {
    hName: string;
    hProperties: {
      className: string[];
      'data-mention': string;
    };
  };
  children: [{ type: 'text'; value: string }];
};

const buildTree = (markdown: string): Root => {
  const processor = unified().use(remarkParse).use(remarkPlugin);
  return processor.runSync(processor.parse(markdown)) as Root;
};

const collectMentionNodes = (markdown: string): MentionNode[] => {
  const tree = buildTree(markdown);
  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') return [];
  return (paragraph.children as unknown[]).filter(
    (n): n is MentionNode => (n as { type: string }).type === 'mention',
  );
};

describe('remarkPlugin', () => {
  describe('basic mention detection', () => {
    test('converts @username to a mention node', () => {
      const nodes = collectMentionNodes('@alice');
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.data.hName).toBe('span');
      expect(nodes[0]?.data.hProperties.className).toContain('mention-user');
      expect(nodes[0]?.data.hProperties['data-mention']).toBe('alice');
      expect(nodes[0]?.children[0].value).toBe('@alice');
    });

    test('detects mention in surrounding text', () => {
      const nodes = collectMentionNodes('hello @alice world');
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.data.hProperties['data-mention']).toBe('alice');
    });

    test('detects multiple mentions in one paragraph', () => {
      const nodes = collectMentionNodes('@alice and @bob');
      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.data.hProperties['data-mention']).toBe('alice');
      expect(nodes[1]?.data.hProperties['data-mention']).toBe('bob');
    });

    test('accepts dots and hyphens in username', () => {
      const nodes = collectMentionNodes('@alice.smith');
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.data.hProperties['data-mention']).toBe('alice.smith');
    });
  });

  describe('non-mention patterns (edge cases)', () => {
    test('does not convert email address', () => {
      const nodes = collectMentionNodes('user@example.com');
      expect(nodes).toHaveLength(0);
    });

    test('does not convert bare @ with no following word chars', () => {
      const nodes = collectMentionNodes('hello @ world');
      expect(nodes).toHaveLength(0);
    });

    test('does not produce mention nodes for empty input', () => {
      const nodes = collectMentionNodes('');
      expect(nodes).toHaveLength(0);
    });

    test('does not produce mention nodes for Japanese-only text', () => {
      const nodes = collectMentionNodes('こんにちは、世界！');
      expect(nodes).toHaveLength(0);
    });

    test('does not convert @username immediately after a word character', () => {
      const nodes = collectMentionNodes('test@alice');
      expect(nodes).toHaveLength(0);
    });
  });
});

describe('sanitizeOption', () => {
  test('allows span tag', () => {
    expect(sanitizeOption.tagNames).toContain('span');
  });

  test('allows className and data-mention attributes on span', () => {
    expect(sanitizeOption.attributes?.span).toContain('className');
    expect(sanitizeOption.attributes?.span).toContain('data-mention');
  });
});
