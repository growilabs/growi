import growiDirective from '@growi/remark-growi-directive';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import katex from 'rehype-katex';
import raw from 'rehype-raw';
import sanitize from 'rehype-sanitize';
import slug from 'rehype-slug';
import breaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import gfm from 'remark-gfm';
import math from 'remark-math';
import deepmerge from 'ts-deepmerge';
import type { Pluggable, PluginTuple } from 'unified';

import { CodeBlock } from '~/components/ReactMarkdownComponents/CodeBlock.js';
import { NextLink } from '~/components/ReactMarkdownComponents/NextLink.js';
import type { RendererOptions } from '~/interfaces/renderer-options.js';
import { RehypeSanitizeType } from '~/interfaces/services/rehype-sanitize.js';
import type { RendererConfig } from '~/interfaces/services/renderer.js';
import loggerFactory from '~/utils/logger/index.js';

import {
  attributes as recommendedAttributes,
  tagNames as recommendedTagNames,
} from './recommended-whitelist.js';
import * as addClass from './rehype-plugins/add-class.js';
import * as addInlineProperty from './rehype-plugins/add-inline-code-property.js';
import { relativeLinks } from './rehype-plugins/relative-links.js';
import { relativeLinksByPukiwikiLikeLinker } from './rehype-plugins/relative-links-by-pukiwiki-like-linker.js';
import * as codeBlock from './remark-plugins/codeblock.js';
import * as echoDirective from './remark-plugins/echo-directive.js';
import * as emoji from './remark-plugins/emoji.js';
import { pukiwikiLikeLinker } from './remark-plugins/pukiwiki-like-linker.js';
import * as xsvToTable from './remark-plugins/xsv-to-table.js';

// import EasyGrid from './PreProcessor/EasyGrid';

const _logger = loggerFactory('growi:services:renderer');

type SanitizePlugin = PluginTuple<[SanitizeOption]>;

let currentInitializedSanitizeType: RehypeSanitizeType =
  RehypeSanitizeType.RECOMMENDED;
let commonSanitizeOption: SanitizeOption;
export const getCommonSanitizeOption = (
  config: RendererConfig,
): SanitizeOption => {
  if (
    commonSanitizeOption == null ||
    config.sanitizeType !== currentInitializedSanitizeType
  ) {
    // initialize
    commonSanitizeOption = deepmerge(
      {
        tagNames:
          config.sanitizeType === RehypeSanitizeType.RECOMMENDED
            ? recommendedTagNames
            : (config.customTagWhitelist ?? recommendedTagNames),
        attributes:
          config.sanitizeType === RehypeSanitizeType.RECOMMENDED
            ? recommendedAttributes
            : (config.customAttrWhitelist ?? recommendedAttributes),
        clobberPrefix: '', // remove clobber prefix
      },
      codeBlock.sanitizeOption,
    );

    currentInitializedSanitizeType = config.sanitizeType;
  }

  return commonSanitizeOption;
};

const isSanitizePlugin = (
  pluggable: Pluggable,
): pluggable is SanitizePlugin => {
  if (!Array.isArray(pluggable) || pluggable.length < 2) {
    return false;
  }
  const sanitizeOption = pluggable[1];
  return 'tagNames' in sanitizeOption && 'attributes' in sanitizeOption;
};

const hasSanitizePlugin = (
  options: RendererOptions,
  shouldBeTheLastItem: boolean,
): boolean => {
  const { rehypePlugins } = options;
  if (rehypePlugins == null || rehypePlugins.length === 0) {
    return false;
  }

  return shouldBeTheLastItem
    ? isSanitizePlugin(rehypePlugins.slice(-1)[0]) // evaluate the last one
    : rehypePlugins.some((rehypePlugin) => isSanitizePlugin(rehypePlugin));
};

export const verifySanitizePlugin = (
  options: RendererOptions,
  shouldBeTheLastItem = true,
): void => {
  if (hasSanitizePlugin(options, shouldBeTheLastItem)) {
    return;
  }

  throw new Error(
    "The specified options does not have sanitize plugin in 'rehypePlugins'",
  );
};

export const generateCommonOptions = (
  pagePath: string | undefined,
): RendererOptions => {
  return {
    remarkPlugins: [
      gfm,
      emoji.remarkPlugin,
      pukiwikiLikeLinker,
      growiDirective,
      remarkDirective,
      echoDirective.remarkPlugin,
      remarkFrontmatter,
      codeBlock.remarkPlugin,
    ],
    remarkRehypeOptions: {
      clobberPrefix: '', // remove clobber prefix
      allowDangerousHtml: true,
    },
    rehypePlugins: [
      [relativeLinksByPukiwikiLikeLinker, { pagePath }],
      [relativeLinks, { pagePath }],
      raw,
      [
        addClass.rehypePlugin,
        {
          table: 'table table-bordered',
        },
      ],
      addInlineProperty.rehypePlugin,
    ],
    components: {
      a: NextLink,
      code: CodeBlock,
    },
  };
};

export const generateSSRViewOptions = (
  config: RendererConfig,
  pagePath: string,
): RendererOptions => {
  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins } = options;

  // add remark plugins
  remarkPlugins.push(math, xsvToTable.remarkPlugin);

  const isEnabledLinebreaks = config.isEnabledLinebreaks;

  if (isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  const rehypeSanitizePlugin: Pluggable | (() => void) =
    config.isEnabledXssPrevention
      ? [sanitize, getCommonSanitizeOption(config)]
      : () => {};

  // add rehype plugins
  rehypePlugins.push(slug, rehypeSanitizePlugin, katex);

  // add components
  // if (components != null) {
  // }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};
