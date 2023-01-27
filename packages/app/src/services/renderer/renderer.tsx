// allow only types to import from react
import { ComponentType } from 'react';

import { isClient } from '@growi/core';
import * as drawioPlugin from '@growi/remark-drawio';
import growiDirective from '@growi/remark-growi-directive';
import { Lsx, LsxImmutable } from '@growi/remark-lsx/components';
import * as lsxGrowiPlugin from '@growi/remark-lsx/services/renderer';
import { Schema as SanitizeOption } from 'hast-util-sanitize';
import { SpecialComponents } from 'react-markdown/lib/ast-to-react';
import { NormalComponents } from 'react-markdown/lib/complex-types';
import { ReactMarkdownOptions } from 'react-markdown/lib/react-markdown';
import katex from 'rehype-katex';
import raw from 'rehype-raw';
import sanitize, { defaultSchema as sanitizeDefaultSchema } from 'rehype-sanitize';
import slug from 'rehype-slug';
import { HtmlElementNode } from 'rehype-toc';
import breaks from 'remark-breaks';
import emoji from 'remark-emoji';
import gfm from 'remark-gfm';
import math from 'remark-math';
import deepmerge from 'ts-deepmerge';
import { PluggableList, Pluggable, PluginTuple } from 'unified';


import { CodeBlock } from '~/components/ReactMarkdownComponents/CodeBlock';
import { DrawioViewerWithEditButton } from '~/components/ReactMarkdownComponents/DrawioViewerWithEditButton';
import { Header } from '~/components/ReactMarkdownComponents/Header';
import { NextLink } from '~/components/ReactMarkdownComponents/NextLink';
import { Table } from '~/components/ReactMarkdownComponents/Table';
import { TableWithEditButton } from '~/components/ReactMarkdownComponents/TableWithEditButton';
import { RehypeSanitizeOption } from '~/interfaces/rehype';
import { RendererConfig } from '~/interfaces/services/renderer';
import { registerGrowiFacade } from '~/utils/growi-facade';
import loggerFactory from '~/utils/logger';

import * as addClass from './rehype-plugins/add-class';
import * as addLineNumberAttribute from './rehype-plugins/add-line-number-attribute';
import * as keywordHighlighter from './rehype-plugins/keyword-highlighter';
import { relativeLinks } from './rehype-plugins/relative-links';
import { relativeLinksByPukiwikiLikeLinker } from './rehype-plugins/relative-links-by-pukiwiki-like-linker';
import * as toc from './rehype-plugins/relocate-toc';
import * as plantuml from './remark-plugins/plantuml';
import { pukiwikiLikeLinker } from './remark-plugins/pukiwiki-like-linker';
import * as table from './remark-plugins/table';
import * as xsvToTable from './remark-plugins/xsv-to-table';

// import EasyGrid from './PreProcessor/EasyGrid';
// import BlockdiagConfigurer from './markdown-it/blockdiag';


const logger = loggerFactory('growi:util:GrowiRenderer');


type SanitizePlugin = PluginTuple<[SanitizeOption]>;
export type RendererOptions = Omit<ReactMarkdownOptions, 'remarkPlugins' | 'rehypePlugins' | 'components' | 'children'> & {
  remarkPlugins: PluggableList,
  rehypePlugins: PluggableList,
  components?:
    | Partial<
        Omit<NormalComponents, keyof SpecialComponents>
        & SpecialComponents
        & {
          [elem: string]: ComponentType<any>,
        }
      >
    | undefined
};

const commonSanitizeAttributes = { '*': ['class', 'className', 'style'] };

const commonSanitizeOption: SanitizeOption = deepmerge(
  sanitizeDefaultSchema,
  {
    clobberPrefix: 'mdcont-',
    attributes: commonSanitizeAttributes,
  },
);

const injectCustomSanitizeOption = (config: RendererConfig) => {
  commonSanitizeOption.tagNames = config.tagWhiteList;
  commonSanitizeOption.attributes = deepmerge(commonSanitizeAttributes, config.attrWhiteList ?? {});
};

const isSanitizePlugin = (pluggable: Pluggable): pluggable is SanitizePlugin => {
  if (!Array.isArray(pluggable) || pluggable.length < 2) {
    return false;
  }
  const sanitizeOption = pluggable[1];
  return 'tagNames' in sanitizeOption && 'attributes' in sanitizeOption;
};

const hasSanitizePlugin = (options: RendererOptions, shouldBeTheLastItem: boolean): boolean => {
  const { rehypePlugins } = options;
  if (rehypePlugins == null || rehypePlugins.length === 0) {
    return false;
  }

  return shouldBeTheLastItem
    ? isSanitizePlugin(rehypePlugins.slice(-1)[0]) // evaluate the last one
    : rehypePlugins.some(rehypePlugin => isSanitizePlugin(rehypePlugin));
};

const verifySanitizePlugin = (options: RendererOptions, shouldBeTheLastItem = true): void => {
  if (hasSanitizePlugin(options, shouldBeTheLastItem)) {
    return;
  }

  throw new Error('The specified options does not have sanitize plugin in \'rehypePlugins\'');
};

const generateCommonOptions = (pagePath: string|undefined): RendererOptions => {
  return {
    remarkPlugins: [
      gfm,
      emoji,
      pukiwikiLikeLinker,
      growiDirective,
    ],
    rehypePlugins: [
      [relativeLinksByPukiwikiLikeLinker, { pagePath }],
      [relativeLinks, { pagePath }],
      raw,
      [addClass.rehypePlugin, {
        table: 'table table-bordered',
      }],
    ],
    components: {
      a: NextLink,
      code: CodeBlock,
    },
  };
};

export const generateViewOptions = (
    pagePath: string,
    config: RendererConfig,
    storeTocNode: (toc: HtmlElementNode) => void,
): RendererOptions => {

  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    [plantuml.remarkPlugin, { plantumlUri: config.plantumlUri }],
    drawioPlugin.remarkPlugin,
    xsvToTable.remarkPlugin,
    lsxGrowiPlugin.remarkPlugin,
  );
  if (config.isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  if (config.xssOption === RehypeSanitizeOption.CUSTOM) {
    injectCustomSanitizeOption(config);
  }

  const rehypeSanitizePlugin: Pluggable<any[]> | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      commonSanitizeOption,
      drawioPlugin.sanitizeOption,
      lsxGrowiPlugin.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    slug,
    [lsxGrowiPlugin.rehypePlugin, { pagePath }],
    rehypeSanitizePlugin,
    katex,
    [toc.rehypePluginStore, { storeTocNode }],
  );

  // add components
  if (components != null) {
    components.h1 = Header;
    components.h2 = Header;
    components.h3 = Header;
    components.lsx = Lsx;
    components.drawio = DrawioViewerWithEditButton;
    components.table = TableWithEditButton;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

export const generateTocOptions = (config: RendererConfig, tocNode: HtmlElementNode | undefined): RendererOptions => {

  const options = generateCommonOptions(undefined);

  const { rehypePlugins } = options;

  // add remark plugins
  // remarkPlugins.push();

  if (config.xssOption === RehypeSanitizeOption.CUSTOM) {
    injectCustomSanitizeOption(config);
  }


  const rehypeSanitizePlugin: Pluggable<any[]> | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      commonSanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [toc.rehypePluginRestore, { tocNode }],
    rehypeSanitizePlugin,
  );

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options);
  }

  return options;
};

export const generateSimpleViewOptions = (
    config: RendererConfig,
    pagePath: string,
    highlightKeywords?: string | string[],
    overrideIsEnabledLinebreaks?: boolean,
): RendererOptions => {
  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    [plantuml.remarkPlugin, { plantumlUri: config.plantumlUri }],
    drawioPlugin.remarkPlugin,
    xsvToTable.remarkPlugin,
    lsxGrowiPlugin.remarkPlugin,
    table.remarkPlugin,
  );

  const isEnabledLinebreaks = overrideIsEnabledLinebreaks ?? config.isEnabledLinebreaks;

  if (isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  if (config.xssOption === RehypeSanitizeOption.CUSTOM) {
    injectCustomSanitizeOption(config);
  }


  const rehypeSanitizePlugin: Pluggable<any[]> | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      commonSanitizeOption,
      drawioPlugin.sanitizeOption,
      lsxGrowiPlugin.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [lsxGrowiPlugin.rehypePlugin, { pagePath }],
    [keywordHighlighter.rehypePlugin, { keywords: highlightKeywords }],
    rehypeSanitizePlugin,
    katex,
  );

  // add components
  if (components != null) {
    components.lsx = LsxImmutable;
    components.drawio = drawioPlugin.DrawioViewer;
    components.table = Table;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

export const generateSSRViewOptions = (
    config: RendererConfig,
    pagePath: string,
): RendererOptions => {
  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    xsvToTable.remarkPlugin,
    lsxGrowiPlugin.remarkPlugin,
    table.remarkPlugin,
  );

  const isEnabledLinebreaks = config.isEnabledLinebreaks;

  if (isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  if (config.xssOption === RehypeSanitizeOption.CUSTOM) {
    injectCustomSanitizeOption(config);
  }

  const rehypeSanitizePlugin: Pluggable<any[]> | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      commonSanitizeOption,
      lsxGrowiPlugin.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [lsxGrowiPlugin.rehypePlugin, { pagePath }],
    rehypeSanitizePlugin,
    katex,
  );

  // add components
  if (components != null) {
    components.lsx = LsxImmutable;
    components.table = Table;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

export const generatePreviewOptions = (config: RendererConfig, pagePath: string): RendererOptions => {
  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    [plantuml.remarkPlugin, { plantumlUri: config.plantumlUri }],
    drawioPlugin.remarkPlugin,
    xsvToTable.remarkPlugin,
    lsxGrowiPlugin.remarkPlugin,
    table.remarkPlugin,
  );
  if (config.isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  if (config.xssOption === RehypeSanitizeOption.CUSTOM) {
    injectCustomSanitizeOption(config);
  }

  const rehypeSanitizePlugin: Pluggable<any[]> | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      commonSanitizeOption,
      lsxGrowiPlugin.sanitizeOption,
      drawioPlugin.sanitizeOption,
      addLineNumberAttribute.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [lsxGrowiPlugin.rehypePlugin, { pagePath }],
    addLineNumberAttribute.rehypePlugin,
    rehypeSanitizePlugin,
    katex,
  );

  // add components
  if (components != null) {
    components.lsx = LsxImmutable;
    components.drawio = drawioPlugin.DrawioViewer;
    components.table = Table;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

// register to facade
if (isClient()) {
  registerGrowiFacade({
    markdownRenderer: {
      optionsGenerators: {
        generateViewOptions,
        generatePreviewOptions,
      },
    },
  });
}
