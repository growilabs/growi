import plantuml from '@akebifiky/remark-simple-plantuml';
import type { Code } from 'mdast';
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

    simplePlantumlPlugin(tree, file);
  };
};
