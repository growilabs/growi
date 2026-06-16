import { addTrailingSlash } from '@growi/core/dist/utils/path-utils';
import { selectAll } from 'hast-util-select';
import type { Plugin } from 'unified';

import {
  type IAnchorsSelector,
  type IUrlResolver,
  type RelativeLinksPluginParams,
  relativeLinks,
} from './relative-links';

const customAnchorsSelector: IAnchorsSelector = (node) => {
  return selectAll('a[href].pukiwiki-like-linker', node);
};

const customUrlResolver: IUrlResolver = (relativeHref, basePath) => {
  // generate relative pathname
  const baseUrl = new URL(addTrailingSlash(basePath), 'https://example.com');
  return new URL(relativeHref, baseUrl);
};

export const relativeLinksByPukiwikiLikeLinker: Plugin<
  [RelativeLinksPluginParams]
> = (options = {}) => {
  return relativeLinks.bind(this)({
    ...options,
    anchorsSelector: customAnchorsSelector,
    urlResolver: customUrlResolver,
  });
};
