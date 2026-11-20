import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import type { Element, Root as HastRoot } from 'hast';
import { defaultSchema, sanitize } from 'hast-util-sanitize';
import plantumlEncoder from 'plantuml-encoder';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import deepmerge from 'ts-deepmerge';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import type { PlantumlHttpMethod } from '../interfaces/http-method';
import carbonGrayDarkStyles from '../themes/carbon-gray-dark.puml';
import carbonGrayLightStyles from '../themes/carbon-gray-light.puml';
import { remarkPlugin, sanitizeOption } from './plantuml';

const PLANTUML_URI = 'https://plantuml.example.com';
const DIAGRAM = 'A -> B: hello';
const MARKDOWN = ['```plantuml', DIAGRAM, '```', ''].join('\n');

const themeOf = (isDarkMode: boolean): string =>
  isDarkMode ? carbonGrayDarkStyles : carbonGrayLightStyles;

const render = (
  markdown: string,
  options: {
    plantumlUri?: string;
    plantumlHttpMethod: PlantumlHttpMethod;
    isDarkMode?: boolean;
  },
): HastRoot => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugin, { plantumlUri: PLANTUML_URI, ...options })
    .use(remarkRehype);
  return processor.runSync(processor.parse(markdown)) as HastRoot;
};

const findPlantumlElements = (tree: HastRoot): Element[] => {
  const found: Element[] = [];
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'plantuml') {
      found.push(node);
    }
  });
  return found;
};

describe('remarkPlugin', () => {
  describe('GET method', () => {
    it.each([
      ['light', false],
      ['dark', true],
    ])('emits <plantuml src> whose encoded source is the %s theme plus the diagram', (_label, isDarkMode) => {
      const tree = render(MARKDOWN, {
        plantumlHttpMethod: 'get',
        isDarkMode,
      });

      const [element] = findPlantumlElements(tree);
      expect(findPlantumlElements(tree)).toHaveLength(1);

      const prefix = `${PLANTUML_URI}/svg/`;
      const src = String(element.properties.src);
      expect(src.startsWith(prefix)).toBe(true);
      expect(plantumlEncoder.decode(src.slice(prefix.length))).toBe(
        `${themeOf(isDarkMode)}\n${DIAGRAM}`,
      );
      expect(element.properties[GROWI_IS_CONTENT_RENDERING_ATTR]).toBe('true');
      expect(element.properties.source).toBeUndefined();
    });
  });

  describe('POST method', () => {
    it.each([
      ['light', false],
      ['dark', true],
    ])('emits <plantuml source> carrying the %s themed source and no src', (_label, isDarkMode) => {
      const tree = render(MARKDOWN, {
        plantumlHttpMethod: 'post',
        isDarkMode,
      });

      const elements = findPlantumlElements(tree);
      expect(elements).toHaveLength(1);
      const [element] = elements;

      expect(element.properties.source).toBe(
        `${themeOf(isDarkMode)}\n${DIAGRAM}`,
      );
      expect(element.properties[GROWI_IS_CONTENT_RENDERING_ATTR]).toBe('true');
      expect(element.properties.src).toBeUndefined();
    });

    it('converts a plantuml block nested in a list item', () => {
      const markdown = [
        '- item',
        '',
        '  ```plantuml',
        `  ${DIAGRAM}`,
        '  ```',
        '',
      ].join('\n');
      const tree = render(markdown, { plantumlHttpMethod: 'post' });

      const elements = findPlantumlElements(tree);
      expect(elements).toHaveLength(1);
      expect(elements[0].properties.source).toBe(
        `${themeOf(false)}\n${DIAGRAM}`,
      );
    });

    it('keeps the source attribute through the sanitizer', () => {
      const tree = render(MARKDOWN, { plantumlHttpMethod: 'post' });
      const schema = deepmerge(
        defaultSchema,
        sanitizeOption,
      ) as typeof defaultSchema;

      const sanitized = sanitize(tree, schema) as HastRoot;

      const [element] = findPlantumlElements(sanitized);
      expect(element.properties.source).toBe(`${themeOf(false)}\n${DIAGRAM}`);
      expect(element.properties[GROWI_IS_CONTENT_RENDERING_ATTR]).toBe('true');
    });

    it('serialises the source as an HTML attribute named source', () => {
      const html = String(
        unified()
          .use(remarkParse)
          .use(remarkPlugin, {
            plantumlUri: PLANTUML_URI,
            plantumlHttpMethod: 'post',
          })
          .use(remarkRehype)
          .use(rehypeSanitize, deepmerge(defaultSchema, sanitizeOption))
          .use(rehypeStringify)
          .processSync(MARKDOWN),
      );

      expect(html).toContain('<plantuml ');
      expect(html).toContain('source="');
      expect(html).not.toContain(' src=');
    });
  });

  describe.each<PlantumlHttpMethod>([
    'get',
    'post',
  ])('in %s mode', (plantumlHttpMethod) => {
    it('creates no <plantuml> element when plantumlUri is empty', () => {
      const tree = render(MARKDOWN, { plantumlUri: '', plantumlHttpMethod });

      expect(findPlantumlElements(tree)).toHaveLength(0);
    });

    it('leaves non-plantuml code blocks untouched', () => {
      const markdown = ['```js', 'const a = 1;', '```', ''].join('\n');
      const tree = render(markdown, { plantumlHttpMethod });

      expect(findPlantumlElements(tree)).toHaveLength(0);
      let codeText = '';
      visit(tree, 'text', (node: { value: string }) => {
        codeText += node.value;
      });
      expect(codeText).toContain('const a = 1;');
    });
  });

  describe('sanitizeOption', () => {
    it('allows src, source and the rendering-status attribute on plantuml', () => {
      expect(sanitizeOption.attributes?.plantuml).toEqual(
        expect.arrayContaining([
          'src',
          'source',
          GROWI_IS_CONTENT_RENDERING_ATTR,
        ]),
      );
    });
  });
});
