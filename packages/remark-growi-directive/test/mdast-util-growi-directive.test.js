import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { removePosition } from 'unist-util-remove-position';
import { describe, expect, it } from 'vitest';

import {
  directiveFromMarkdown,
  directiveToMarkdown,
} from '../src/mdast-util-growi-directive/index.js';
import { DirectiveType } from '../src/mdast-util-growi-directive/lib/index.js';
import { directive } from '../src/micromark-extension-growi-directive/index.js';

describe('markdown -> mdast', () => {
  it('should support directives (text)', () => {
    expect(
      fromMarkdown('a $b[c](d) e.', {
        extensions: [directive()],
        mdastExtensions: [directiveFromMarkdown()],
      }).children[0],
    ).toEqual({
      type: 'paragraph',
      children: [
        {
          type: 'text',
          value: 'a ',
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 1, column: 3, offset: 2 },
          },
        },
        {
          type: DirectiveType.Text,
          name: 'b',
          attributes: { d: '' },
          children: [
            {
              type: 'text',
              value: 'c',
              position: {
                start: { line: 1, column: 6, offset: 5 },
                end: { line: 1, column: 7, offset: 6 },
              },
            },
          ],
          position: {
            start: { line: 1, column: 3, offset: 2 },
            end: { line: 1, column: 11, offset: 10 },
          },
        },
        {
          type: 'text',
          value: ' e.',
          position: {
            start: { line: 1, column: 11, offset: 10 },
            end: { line: 1, column: 14, offset: 13 },
          },
        },
      ],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 14, offset: 13 },
      },
    });
  });

  it('should support directives (leaf)', () => {
    expect(
      fromMarkdown('$a[b](c)', {
        extensions: [directive()],
        mdastExtensions: [directiveFromMarkdown()],
      }).children[0],
    ).toEqual({
      type: DirectiveType.Leaf,
      name: 'a',
      attributes: { c: '' },
      children: [
        {
          type: 'text',
          value: 'b',
          position: {
            start: { line: 1, column: 4, offset: 3 },
            end: { line: 1, column: 5, offset: 4 },
          },
        },
      ],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 9, offset: 8 },
      },
    });
  });

  it('should support content in a label', () => {
    const tree = fromMarkdown('x $a[b *c*\nd]', {
      extensions: [directive()],
      mdastExtensions: [directiveFromMarkdown()],
    });

    removePosition(tree, { force: true });

    expect(tree).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'x ' },
            {
              type: DirectiveType.Text,
              name: 'a',
              attributes: {},
              children: [
                { type: 'text', value: 'b ' },
                { type: 'emphasis', children: [{ type: 'text', value: 'c' }] },
                { type: 'text', value: '\nd' },
              ],
            },
          ],
        },
      ],
    });
  });

  it('should support attributes', () => {
    const tree = fromMarkdown('x $a(#b.c.d e=f g="h&amp;i&unknown;j")', {
      extensions: [directive()],
      mdastExtensions: [directiveFromMarkdown()],
    });

    removePosition(tree, { force: true });

    expect(tree).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'x ' },
            {
              type: DirectiveType.Text,
              name: 'a',
              attributes: {
                '#b.c.d': '',
                e: 'f',
                g: 'h&i&unknown;j',
              },
              children: [],
            },
          ],
        },
      ],
    });
  });

  it('should support EOLs in attributes', () => {
    const tree = fromMarkdown('$a(b\nc="d\ne")', {
      extensions: [directive()],
      mdastExtensions: [directiveFromMarkdown()],
    });

    removePosition(tree, { force: true });

    expect(tree).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: DirectiveType.Text,
              name: 'a',
              attributes: { b: '', c: 'd\ne' },
              children: [],
            },
          ],
        },
      ],
    });
  });
});

describe('mdast -> markdown', () => {
  it('should try to serialize a directive (text) w/o `name`', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            // @ts-expect-error: `children`, `name` missing.
            { type: DirectiveType.Text },
            { type: 'text', value: ' b.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $ b.\n');
  });

  it('should serialize a directive (text) w/ `name`', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            // @ts-expect-error: `children` missing.
            { type: DirectiveType.Text, name: 'b' },
            { type: 'text', value: ' c.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b c.\n');
  });

  it('should serialize a directive (text) w/ `children`', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              children: [{ type: 'text', value: 'c' }],
            },
            { type: 'text', value: ' d.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b[c] d.\n');
  });

  it('should escape brackets in a directive (text) label', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              children: [{ type: 'text', value: 'c[d]e' }],
            },
            { type: 'text', value: ' f.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b[c\\[d\\]e] f.\n');
  });

  it('should support EOLs in a directive (text) label', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              children: [{ type: 'text', value: 'c\nd' }],
            },
            { type: 'text', value: ' e.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b[c\nd] e.\n');
  });

  it('should serialize a directive (text) w/ `attributes`', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              // @ts-expect-error: should contain only `string`s
              attributes: {
                c: 'd',
                e: 'f',
                g: '',
                h: null,
                i: undefined,
                j: 2,
              },
              children: [],
            },
            { type: 'text', value: ' k.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b(c="d" e="f" g j="2") k.\n');
  });

  it('should serialize a directive (text) w/ hash, dot notation attributes', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              attributes: { '#d': '', '.a.b.c': '', key: 'value' },
              children: [],
            },
            { type: 'text', value: ' k.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b(#d .a.b.c key="value") k.\n');
  });

  it('should encode the quote in an attribute value (text)', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              attributes: { x: 'y"\'\r\nz' },
              children: [],
            },
            { type: 'text', value: ' k.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b(x="y&#x22;\'\r\nz") k.\n');
  });

  it('should not use the `id` shortcut if impossible characters exist', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              attributes: { id: 'c#d' },
              children: [],
            },
            { type: 'text', value: ' e.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b(id="c#d") e.\n');
  });

  it('should not use the `class` shortcut if impossible characters exist', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              attributes: { 'c.d': '', 'e<f': '' },
              children: [],
            },
            { type: 'text', value: ' g.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b(c.d e<f) g.\n');
  });

  it("should not use the `class` shortcut if impossible characters exist (but should use it for classes that don't)", () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a ' },
            {
              type: DirectiveType.Text,
              name: 'b',
              attributes: {
                'c.d': '',
                e: '',
                'f<g': '',
                hij: '',
              },
              children: [],
            },
            { type: 'text', value: ' k.' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a $b(c.d e f<g hij) k.\n');
  });

  it('should try to serialize a directive (leaf) w/o `name`', () => {
    // @ts-expect-error: `children`, `name` missing.
    expect(
      toMarkdown(
        { type: DirectiveType.Leaf },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$\n');
  });

  it('should serialize a directive (leaf) w/ `name`', () => {
    // @ts-expect-error: `children` missing.
    expect(
      toMarkdown(
        { type: DirectiveType.Leaf, name: 'a' },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$a\n');
  });

  it('should serialize a directive (leaf) w/ `children`', () => {
    expect(
      toMarkdown(
        {
          type: DirectiveType.Leaf,
          name: 'a',
          children: [{ type: 'text', value: 'b' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$a[b]\n');
  });

  it('should serialize a directive (leaf) w/ EOLs in `children`', () => {
    expect(
      toMarkdown(
        {
          type: DirectiveType.Leaf,
          name: 'a',
          children: [{ type: 'text', value: 'b\nc' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$a[b&#xA;c]\n');
  });

  it('should serialize a directive (leaf) w/ EOLs in `attributes`', () => {
    expect(
      toMarkdown(
        {
          type: DirectiveType.Leaf,
          name: 'a',
          attributes: { '#b': '', '.c.d': '', key: 'e\nf' },
          children: [],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$a(#b .c.d key="e&#xA;f")\n');
  });

  it('should escape a `:` in phrasing when followed by an alpha', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'a$b' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a\\$b\n');
  });

  it('should not escape a `:` in phrasing when followed by a non-alpha', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'a$9' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a$9\n');
  });

  it('should not escape a `:` in phrasing when preceded by a colon', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'a$c' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('a\\$c\n');
  });

  it('should not escape a `:` at a break', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '$\na' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$\na\n');
  });

  it('should not escape a `:` at a break when followed by an alpha', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '$a' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('\\$a\n');
  });

  it('should escape a `:` at a break when followed by a colon', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '$\na' }],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$\na\n');
  });

  it('should escape a `:` after a text directive', () => {
    expect(
      toMarkdown(
        {
          type: 'paragraph',
          children: [
            { type: DirectiveType.Text, name: 'red', children: [] },
            { type: 'text', value: '$' },
          ],
        },
        { extensions: [directiveToMarkdown()] },
      ),
    ).toBe('$red$\n');
  });
});
