import plantuml from '@akebifiky/remark-simple-plantuml';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Code, Image, Parent } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import urljoin from 'url-join';

import type { PlantumlHttpMethod } from '../interfaces/http-method';
import carbonGrayDarkStyles from '../themes/carbon-gray-dark.puml';
import carbonGrayLightStyles from '../themes/carbon-gray-light.puml';

type PlantUMLPluginParams = {
  plantumlUri: string;
  plantumlHttpMethod: PlantumlHttpMethod;
  isDarkMode?: boolean;
};

export const remarkPlugin: Plugin<[PlantUMLPluginParams]> = (options) => {
  const { plantumlUri, plantumlHttpMethod, isDarkMode } = options;

  const baseUrl = urljoin(plantumlUri, '/svg');
  const simplePlantumlPlugin = plantuml.bind(this)({ baseUrl });

  return (tree, file) => {
    visit(
      tree,
      'code',
      (node: Code, index: number | undefined, parent: Parent | undefined) => {
        if (node.lang !== 'plantuml') {
          return;
        }

        const themeStyles = isDarkMode
          ? carbonGrayDarkStyles
          : carbonGrayLightStyles;
        node.value = `${themeStyles}\n${node.value}`;

        // POST sends the source from the browser, so no encoded URL is built.
        if (
          plantumlHttpMethod === 'post' &&
          plantumlUri.length > 0 &&
          index != null &&
          parent != null
        ) {
          parent.children[index] = {
            type: 'paragraph',
            children: [],
            data: {
              hName: 'plantuml',
              hProperties: {
                source: node.value,
                [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true',
              },
            },
          };
        }
      },
    );

    if (plantumlHttpMethod === 'post') {
      return;
    }

    // Let remark-simple-plantuml convert plantuml code blocks to image nodes
    simplePlantumlPlugin(tree, file);

    // Transform plantuml image nodes into custom <plantuml> elements that carry
    // the rendering-status attribute, allowing the auto-scroll system to detect
    // and compensate for the layout shift caused by async image loading.
    visit(
      tree,
      'image',
      (node: Image, index: number | undefined, parent: Parent | undefined) => {
        if (plantumlUri.length === 0 || !node.url.startsWith(baseUrl)) {
          return;
        }
        if (index == null || parent == null) {
          return;
        }

        const src = node.url;

        // Replace the image node with a custom paragraph-like element.
        // hName overrides the HTML tag; hProperties set element attributes.
        parent.children[index] = {
          type: 'paragraph',
          children: [],
          data: {
            hName: 'plantuml',
            hProperties: {
              src,
              [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true',
            },
          },
        };
      },
    );
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['plantuml'],
  attributes: {
    plantuml: ['src', 'source', GROWI_IS_CONTENT_RENDERING_ATTR],
  },
};
