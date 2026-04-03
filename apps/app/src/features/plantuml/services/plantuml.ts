import plantuml from '@akebifiky/remark-simple-plantuml';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Code, Image } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import urljoin from 'url-join';

import carbonGrayDarkStyles from '../themes/carbon-gray-dark.puml';
import carbonGrayLightStyles from '../themes/carbon-gray-light.puml';

type PlantUMLPluginParams = {
  plantumlUri: string;
  isDarkMode?: boolean;
};

export const remarkPlugin: Plugin<[PlantUMLPluginParams]> = (options) => {
  const { plantumlUri, isDarkMode } = options;

  const baseUrl = urljoin(plantumlUri, '/svg');
  const simplePlantumlPlugin = plantuml.bind(this)({ baseUrl });

  return (tree, file) => {
    visit(tree, 'code', (node: Code) => {
      if (node.lang === 'plantuml') {
        const themeStyles = isDarkMode
          ? carbonGrayDarkStyles
          : carbonGrayLightStyles;
        node.value = `${themeStyles}\n${node.value}`;
      }
    });

    // Let remark-simple-plantuml convert plantuml code blocks to image nodes
    simplePlantumlPlugin(tree, file);

    // Transform plantuml image nodes into custom <plantuml> elements that carry
    // the rendering-status attribute, allowing the auto-scroll system to detect
    // and compensate for the layout shift caused by async image loading.
    visit(tree, 'image', (node: Image) => {
      if (plantumlUri.length === 0 || !node.url.startsWith(baseUrl)) {
        return;
      }

      const src = node.url;

      // Mutate the image node into a custom paragraph-like element.
      // hName overrides the HTML tag; hProperties set element attributes.
      const mutableNode = node as unknown as Record<string, unknown>;
      mutableNode.type = 'paragraph';
      mutableNode.children = [];
      mutableNode.url = undefined;
      mutableNode.alt = undefined;
      mutableNode.data = {
        hName: 'plantuml',
        hProperties: {
          src,
          [GROWI_IS_CONTENT_RENDERING_ATTR]: 'true',
        },
      };
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['plantuml'],
  attributes: {
    plantuml: ['src', GROWI_IS_CONTENT_RENDERING_ATTR],
  },
};
