import type { ContainerDirective } from 'mdast-util-directive';
import remarkDirective from 'remark-directive';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import * as callout from './callout';

describe('remarkPlugin', () => {
  it('should transform containerDirective to callout', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkDirective)
      .use(callout.remarkPlugin);

    const markdown = `
:::info
This is an info callout.
:::
    `;

    const tree = processor.parse(markdown);
    processor.runSync(tree);

    let calloutNode: ContainerDirective | undefined;
    visit(tree, 'containerDirective', (node) => {
      calloutNode = node;
    });

    expect(calloutNode).toBeDefined();

    assert(calloutNode?.data?.hName != null);
    assert(calloutNode?.data?.hProperties != null);

    expect(calloutNode.data.hName).toBe('callout');
    expect(calloutNode.data.hProperties.type).toBe('info');
    expect(calloutNode.data.hProperties.label).not.toBeDefined();

    assert('children' in calloutNode.children[0]);
    assert('value' in calloutNode.children[0].children[0]);

    expect(calloutNode.children.length).toBe(1);
    expect(calloutNode.children[0].children[0].value).toBe(
      'This is an info callout.',
    );
  });

  it('should transform containerDirective to callout with custom label', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkDirective)
      .use(callout.remarkPlugin);

    const markdown = `
:::info[CUSTOM LABEL]
This is an info callout.
:::
    `;

    const tree = processor.parse(markdown);
    processor.runSync(tree);

    let calloutNode: ContainerDirective | undefined;
    visit(tree, 'containerDirective', (node) => {
      calloutNode = node;
    });

    expect(calloutNode).toBeDefined();

    assert(calloutNode?.data?.hName != null);
    assert(calloutNode?.data?.hProperties != null);

    expect(calloutNode.data.hName).toBe('callout');
    expect(calloutNode.data.hProperties.type).toBe('info');
    expect(calloutNode.data.hProperties.label).toBe('CUSTOM LABEL');

    assert('children' in calloutNode.children[0]);
    assert('value' in calloutNode.children[0].children[0]);

    expect(calloutNode.children.length).toBe(1);
    expect(calloutNode.children[0].children[0].value).toBe(
      'This is an info callout.',
    );
  });

  it('should transform containerDirective to callout with empty label', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkDirective)
      .use(callout.remarkPlugin);

    const markdown = `
:::info[]
This is an info callout.
:::
    `;

    const tree = processor.parse(markdown);
    processor.runSync(tree);

    let calloutNode: ContainerDirective | undefined;
    visit(tree, 'containerDirective', (node) => {
      calloutNode = node;
    });

    expect(calloutNode).toBeDefined();

    assert(calloutNode?.data?.hName != null);
    assert(calloutNode?.data?.hProperties != null);

    expect(calloutNode.data.hName).toBe('callout');
    expect(calloutNode.data.hProperties.type).toBe('info');
    expect(calloutNode.data.hProperties.label).not.toBeDefined();

    assert('children' in calloutNode.children[0]);
    assert('value' in calloutNode.children[0].children[0]);

    expect(calloutNode.children.length).toBe(1);
    expect(calloutNode.children[0].children[0].value).toBe(
      'This is an info callout.',
    );
  });
});
