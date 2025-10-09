import assert from 'assert';

import { isClient } from '@growi/core/dist/utils/browser-utils';
import * as presentation from '@growi/presentation/dist/client/services/sanitize-option';
import * as refsGrowiDirective from '@growi/remark-attachment-refs/dist/client';
import * as drawio from '@growi/remark-drawio';
import * as lsxGrowiDirective from '@growi/remark-lsx/dist/client';
import katex from 'rehype-katex';
import sanitize from 'rehype-sanitize';
import slug from 'rehype-slug';
import type { HtmlElementNode } from 'rehype-toc';
import breaks from 'remark-breaks';
import remarkGithubAdmonitionsToDirectives from 'remark-github-admonitions-to-directives';
import math from 'remark-math';
import deepmerge from 'ts-deepmerge';
import type { Pluggable } from 'unified';

import { DrawioViewerWithEditButton } from '~/client/components/ReactMarkdownComponents/DrawioViewerWithEditButton';
import { Header } from '~/client/components/ReactMarkdownComponents/Header';
import { LightBox } from '~/client/components/ReactMarkdownComponents/LightBox';
import { RichAttachment } from '~/client/components/ReactMarkdownComponents/RichAttachment';
import { TableWithEditButton } from '~/client/components/ReactMarkdownComponents/TableWithEditButton';
import * as callout from '~/features/callout';
import * as mermaid from '~/features/mermaid';
import * as plantuml from '~/features/plantuml';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { type RendererConfigExt } from '~/interfaces/services/renderer';
import * as addLineNumberAttribute from '~/services/renderer/rehype-plugins/add-line-number-attribute';
import * as keywordHighlighter from '~/services/renderer/rehype-plugins/keyword-highlighter';
import * as relocateToc from '~/services/renderer/rehype-plugins/relocate-toc';
import * as attachment from '~/services/renderer/remark-plugins/attachment';
import * as codeBlock from '~/services/renderer/remark-plugins/codeblock';
import * as xsvToTable from '~/services/renderer/remark-plugins/xsv-to-table';
import {
  getCommonSanitizeOption, generateCommonOptions, verifySanitizePlugin,
} from '~/services/renderer/renderer';
import loggerFactory from '~/utils/logger';

// import EasyGrid from './PreProcessor/EasyGrid';


import '@growi/remark-lsx/dist/client/style.css';
import '@growi/remark-attachment-refs/dist/client/style.css';


const logger = loggerFactory('growi:cli:services:renderer');


assert(isClient(), 'This module must be loaded only from client modules.');


export const generateViewOptions = (
    pagePath: string,
    config: RendererConfigExt,
    storeTocNode: (toc: HtmlElementNode) => void,
): RendererOptions => {

  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    [plantuml.remarkPlugin, { plantumlUri: config.plantumlUri, isDarkMode: config.isDarkMode }],
    [drawio.remarkPlugin, { isDarkMode: config.isDarkMode }],
    mermaid.remarkPlugin,
    xsvToTable.remarkPlugin,
    attachment.remarkPlugin,
    remarkGithubAdmonitionsToDirectives,
    callout.remarkPlugin,
    lsxGrowiDirective.remarkPlugin,
    refsGrowiDirective.remarkPlugin,
  );
  if (config.isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  const rehypeSanitizePlugin: Pluggable | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      getCommonSanitizeOption(config),
      presentation.sanitizeOption,
      drawio.sanitizeOption,
      mermaid.sanitizeOption,
      callout.sanitizeOption,
      attachment.sanitizeOption,
      lsxGrowiDirective.sanitizeOption,
      refsGrowiDirective.sanitizeOption,
      codeBlock.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    slug,
    [lsxGrowiDirective.rehypePlugin, { pagePath, isSharedPage: config.isSharedPage }],
    [refsGrowiDirective.rehypePlugin, { pagePath }],
    rehypeSanitizePlugin,
    katex,
    [relocateToc.rehypePluginStore, { storeTocNode }],
  );

  // add components
  if (components != null) {
    components.h1 = Header;
    components.h2 = Header;
    components.h3 = Header;
    components.h4 = Header;
    components.h5 = Header;
    components.h6 = Header;
    components.lsx = lsxGrowiDirective.Lsx;
    components.ref = refsGrowiDirective.Ref;
    components.refs = refsGrowiDirective.Refs;
    components.refimg = refsGrowiDirective.RefImg;
    components.refsimg = refsGrowiDirective.RefsImg;
    components.gallery = refsGrowiDirective.Gallery;
    components.drawio = DrawioViewerWithEditButton;
    components.table = TableWithEditButton;
    components.mermaid = mermaid.MermaidViewer;
    components.callout = callout.CalloutViewer;
    components.attachment = RichAttachment;
    components.img = LightBox;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

export const generateTocOptions = (config: RendererConfigExt, tocNode: HtmlElementNode | undefined): RendererOptions => {

  const options = generateCommonOptions(undefined);

  const { rehypePlugins } = options;

  // add remark plugins
  // remarkPlugins.push();

  const rehypeSanitizePlugin: Pluggable | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      getCommonSanitizeOption(config),
      codeBlock.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [relocateToc.rehypePluginRestore, { tocNode }],
    rehypeSanitizePlugin,
  );

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options);
  }

  return options;
};

export const generateSimpleViewOptions = (
    config: RendererConfigExt,
    pagePath: string,
    highlightKeywords?: string | string[],
    overrideIsEnabledLinebreaks?: boolean,
): RendererOptions => {
  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    [plantuml.remarkPlugin, { plantumlUri: config.plantumlUri, isDarkMode: config.isDarkMode }],
    [drawio.remarkPlugin, { isDarkMode: config.isDarkMode }],
    mermaid.remarkPlugin,
    xsvToTable.remarkPlugin,
    attachment.remarkPlugin,
    remarkGithubAdmonitionsToDirectives,
    callout.remarkPlugin,
    lsxGrowiDirective.remarkPlugin,
    refsGrowiDirective.remarkPlugin,
  );

  const isEnabledLinebreaks = overrideIsEnabledLinebreaks ?? config.isEnabledLinebreaks;

  if (isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  const rehypeSanitizePlugin: Pluggable | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      getCommonSanitizeOption(config),
      presentation.sanitizeOption,
      drawio.sanitizeOption,
      mermaid.sanitizeOption,
      callout.sanitizeOption,
      attachment.sanitizeOption,
      lsxGrowiDirective.sanitizeOption,
      refsGrowiDirective.sanitizeOption,
      codeBlock.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [lsxGrowiDirective.rehypePlugin, { pagePath, isSharedPage: config.isSharedPage }],
    [refsGrowiDirective.rehypePlugin, { pagePath }],
    [keywordHighlighter.rehypePlugin, { keywords: highlightKeywords }],
    rehypeSanitizePlugin,
    katex,
  );

  // add components
  if (components != null) {
    components.lsx = lsxGrowiDirective.LsxImmutable;
    components.ref = refsGrowiDirective.RefImmutable;
    components.refs = refsGrowiDirective.RefsImmutable;
    components.refimg = refsGrowiDirective.RefImgImmutable;
    components.refsimg = refsGrowiDirective.RefsImgImmutable;
    components.gallery = refsGrowiDirective.GalleryImmutable;
    components.drawio = drawio.DrawioViewer;
    components.mermaid = mermaid.MermaidViewer;
    components.callout = callout.CalloutViewer;
    components.attachment = RichAttachment;
    components.img = LightBox;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

export const generatePresentationViewOptions = (
    config: RendererConfigExt,
    pagePath: string,
): RendererOptions => {
  // based on simple view options
  const options = generateSimpleViewOptions(config, pagePath);

  const { rehypePlugins } = options;


  const rehypeSanitizePlugin: Pluggable | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      addLineNumberAttribute.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    addLineNumberAttribute.rehypePlugin,
    rehypeSanitizePlugin,
  );

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};

export const generatePreviewOptions = (config: RendererConfigExt, pagePath: string): RendererOptions => {
  const options = generateCommonOptions(pagePath);

  const { remarkPlugins, rehypePlugins, components } = options;

  // add remark plugins
  remarkPlugins.push(
    math,
    [plantuml.remarkPlugin, { plantumlUri: config.plantumlUri, isDarkMode: config.isDarkMode }],
    [drawio.remarkPlugin, { isDarkMode: config.isDarkMode }],
    mermaid.remarkPlugin,
    xsvToTable.remarkPlugin,
    attachment.remarkPlugin,
    remarkGithubAdmonitionsToDirectives,
    callout.remarkPlugin,
    lsxGrowiDirective.remarkPlugin,
    refsGrowiDirective.remarkPlugin,
  );
  if (config.isEnabledLinebreaks) {
    remarkPlugins.push(breaks);
  }

  const rehypeSanitizePlugin: Pluggable | (() => void) = config.isEnabledXssPrevention
    ? [sanitize, deepmerge(
      getCommonSanitizeOption(config),
      drawio.sanitizeOption,
      mermaid.sanitizeOption,
      callout.sanitizeOption,
      attachment.sanitizeOption,
      lsxGrowiDirective.sanitizeOption,
      refsGrowiDirective.sanitizeOption,
      addLineNumberAttribute.sanitizeOption,
      codeBlock.sanitizeOption,
    )]
    : () => {};

  // add rehype plugins
  rehypePlugins.push(
    [lsxGrowiDirective.rehypePlugin, { pagePath, isSharedPage: config.isSharedPage }],
    [refsGrowiDirective.rehypePlugin, { pagePath }],
    addLineNumberAttribute.rehypePlugin,
    rehypeSanitizePlugin,
    katex,
  );

  // add components
  if (components != null) {
    components.lsx = lsxGrowiDirective.LsxImmutable;
    components.ref = refsGrowiDirective.RefImmutable;
    components.refs = refsGrowiDirective.RefsImmutable;
    components.refimg = refsGrowiDirective.RefImgImmutable;
    components.refsimg = refsGrowiDirective.RefsImgImmutable;
    components.gallery = refsGrowiDirective.GalleryImmutable;
    components.drawio = drawio.DrawioViewer;
    components.mermaid = mermaid.MermaidViewer;
    components.callout = callout.CalloutViewer;
    components.attachment = RichAttachment;
    components.img = LightBox;
  }

  if (config.isEnabledXssPrevention) {
    verifySanitizePlugin(options, false);
  }
  return options;
};
