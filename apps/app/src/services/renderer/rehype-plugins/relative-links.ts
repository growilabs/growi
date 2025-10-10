import assert from 'assert';

import type { Element, Nodes as HastNode } from 'hast';
import { selectAll } from 'hast-util-select';
import isAbsolute from 'is-absolute-url';
import type { Plugin } from 'unified';

export type IAnchorsSelector = (node: HastNode) => Element[];
export type IUrlResolver = (relativeHref: string, basePath: string) => URL;

const defaultAnchorsSelector: IAnchorsSelector = (node) => {
  return selectAll('a[href]', node);
};

const defaultUrlResolver: IUrlResolver = (relativeHref, basePath) => {
  // generate relative pathname
  const baseUrl = new URL(basePath, 'https://example.com');
  return new URL(relativeHref, baseUrl);
};

const urlToHref = (url: URL): string => {
  const { pathname, search, hash } = url;
  return `${pathname}${search}${hash}`;
};

const isAnchorLink = (href: string): boolean => {
  return href.toString().length > 0 && href[0] === '#';
};

export type RelativeLinksPluginParams = {
  pagePath?: string;
  anchorsSelector?: IAnchorsSelector;
  urlResolver?: IUrlResolver;
};

export const relativeLinks: Plugin<[RelativeLinksPluginParams]> = (
  options = {},
) => {
  const anchorsSelector = options.anchorsSelector ?? defaultAnchorsSelector;
  const urlResolver = options.urlResolver ?? defaultUrlResolver;

  return (tree) => {
    if (options.pagePath == null) {
      return;
    }

    const pagePath = options.pagePath;
    const anchors = anchorsSelector(tree as HastNode);

    anchors.forEach((anchor) => {
      assert(anchor.properties != null);

      const href = anchor.properties.href;
      if (
        href == null ||
        typeof href !== 'string' ||
        isAbsolute(href) ||
        isAnchorLink(href)
      ) {
        return;
      }

      anchor.properties.href = urlToHref(urlResolver(href, pagePath));
    });
  };
};
