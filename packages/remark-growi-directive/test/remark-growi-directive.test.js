/**
 * @typedef {import('mdast').Root} Root
 */

import fs from 'node:fs';
import path from 'node:path';
import { isHidden } from 'is-hidden';
import { remark } from 'remark';
import { readSync } from 'to-vfile';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { remarkGrowiDirectivePlugin } from '../src/remark-growi-directive.js';

describe('directive()', () => {
  it('should not throw if not passed options', () => {
    expect(() => {
      remark().use(remarkGrowiDirectivePlugin).freeze();
    }).not.toThrow();
  });

  it('should not throw if without parser or compiler', () => {
    expect(() => {
      unified().use(remarkGrowiDirectivePlugin).freeze();
    }).not.toThrow();
  });
});

describe('fixtures', () => {
  const base = path.join('test', 'fixtures');
  const entries = fs.readdirSync(base).filter((d) => !isHidden(d));

  for (const fixture of entries) {
    it(`should handle ${fixture}`, () => {
      const file = readSync(path.join(base, fixture, 'input.md'));
      const input = String(file);
      const outputPath = path.join(base, fixture, 'output.md');
      const treePath = path.join(base, fixture, 'tree.json');
      const proc = remark().use(remarkGrowiDirectivePlugin).freeze();
      const actual = proc.parse(file);
      /** @type {string} */
      let output;
      /** @type {Root} */
      let expected;

      try {
        expected = JSON.parse(String(fs.readFileSync(treePath)));
      } catch {
        // New fixture.
        fs.writeFileSync(treePath, `${JSON.stringify(actual, null, 2)}\n`);
        expected = actual;
      }

      try {
        output = fs.readFileSync(outputPath, 'utf8');
      } catch {
        output = input;
      }

      expect(actual).toEqual(expected);
      expect(String(proc.processSync(file))).toBe(output);
    });
  }
});
