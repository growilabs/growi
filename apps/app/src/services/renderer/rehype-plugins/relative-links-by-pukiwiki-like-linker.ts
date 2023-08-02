import { pathUtils } from '@growi/core';
import { selectAll } from 'hast-util-select';
import type { Plugin } from 'unified';

import {
  relativeLinks,
  type IAnchorsSelector, type IUrlResolver, type RelativeLinksPluginParams,
} from './relative-links';

const customAnchorsSelector: IAnchorsSelector = (node) => {
  return selectAll('a[href].pukiwiki-like-linker', node);
};

const customUrlResolver: IUrlResolver = (relativeHref, basePath) => {
  // generate relative pathname
  const baseUrl = new URL(pathUtils.addTrailingSlash(basePath), 'https://example.com');
  return new URL(relativeHref, baseUrl);
};

export const relativeLinksByPukiwikiLikeLinker: Plugin<[RelativeLinksPluginParams]> = (options = {}) => {
  return relativeLinks.bind(this)({
    ...options,
    anchorsSelector: customAnchorsSelector,
    urlResolver: customUrlResolver,
  });
};
