import { pathUtils } from '@growi/core/dist/utils';
import type {
  LeafGrowiPluginDirective,
  TextGrowiPluginDirective,
} from '@growi/remark-growi-directive';
import { remarkGrowiDirectivePluginType } from '@growi/remark-growi-directive';
import type { Nodes as HastNode } from 'hast';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import { selectAll } from 'hast-util-select';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

import loggerFactory from '../../../utils/logger';

const logger = loggerFactory(
  'growi:remark-attachment-refs:services:renderer:refs',
);

const REF_SINGLE_NAME_PATTERN = new RegExp(/refimg|ref/);
const REF_MULTI_NAME_PATTERN = new RegExp(/refsimg|refs|gallery/);

const REF_SUPPORTED_ATTRIBUTES = ['fileNameOrId', 'pagePath'];
const REF_IMG_SUPPORTED_ATTRIBUTES = [
  'fileNameOrId',
  'pagePath',
  'width',
  'height',
  'maxWidth',
  'maxHeight',
  'alt',
];
const REFS_SUPPORTED_ATTRIBUTES = ['pagePath', 'prefix', 'depth', 'regexp'];
const REFS_IMG_SUPPORTED_ATTRIBUTES = [
  'pagePath',
  'prefix',
  'depth',
  'regexp',
  'width',
  'height',
  'maxWidth',
  'maxHeight',
  'display',
  'grid',
  'gridGap',
  'noCarousel',
];

type DirectiveAttributes = Record<string, string>;
type GrowiPluginDirective = TextGrowiPluginDirective | LeafGrowiPluginDirective;

export const remarkPlugin: Plugin = () => (tree) => {
  visit(tree, (node: GrowiPluginDirective) => {
    if (
      node.type === remarkGrowiDirectivePluginType.Text ||
      node.type === remarkGrowiDirectivePluginType.Leaf
    ) {
      if (typeof node.name !== 'string') {
        return;
      }
      if (node.data == null) {
        node.data = {};
      }
      const data = node.data;
      const attributes = (node.attributes as DirectiveAttributes) || {};
      const attrEntries = Object.entries(attributes);

      if (REF_SINGLE_NAME_PATTERN.test(node.name)) {
        // determine fileNameOrId
        // order:
        //   1: ref(file=..., ...)
        //   2: ref(id=..., ...)
        //   3: refs(firstArgs, ...)
        let fileNameOrId: string = attributes.file || attributes.id;
        if (fileNameOrId == null && attrEntries.length > 0) {
          const [firstAttrKey, firstAttrValue] = attrEntries[0];
          fileNameOrId =
            firstAttrValue === '' &&
            !REF_SUPPORTED_ATTRIBUTES.concat(
              REF_IMG_SUPPORTED_ATTRIBUTES,
            ).includes(firstAttrValue)
              ? firstAttrKey
              : '';
        }
        attributes.fileNameOrId = fileNameOrId;
      } else if (REF_MULTI_NAME_PATTERN.test(node.name)) {
        // set 'page' attribute if the first attribute is only value
        // e.g.
        //   case 1: refs(page=/path..., ...)    => page="/path"
        //   case 2: refs(/path, ...)            => page="/path"
        //   case 3: refs(/foo, page=/bar ...)   => page="/bar"
        if (attributes.page == null && attrEntries.length > 0) {
          const [firstAttrKey, firstAttrValue] = attrEntries[0];

          if (
            firstAttrValue === '' &&
            !REFS_SUPPORTED_ATTRIBUTES.concat(
              REFS_IMG_SUPPORTED_ATTRIBUTES,
            ).includes(firstAttrValue)
          ) {
            attributes.page = firstAttrKey;
          }
        }
      } else {
        return;
      }

      logger.debug('a node detected', attributes);

      // kebab case to camel case
      attributes.maxWidth = attributes['max-width'];
      attributes.maxHeight = attributes['max-height'];
      attributes.gridGap = attributes['grid-gap'];
      attributes.noCarousel = attributes['no-carousel'];

      data.hName = node.name;
      data.hProperties = attributes;
    }
  });
};

// return absolute path for the specified path
const getAbsolutePathFor = (relativePath: string, basePath: string) => {
  const baseUrl = new URL(
    pathUtils.addTrailingSlash(basePath),
    'https://example.com',
  );
  const absoluteUrl = new URL(relativePath, baseUrl);
  return decodeURIComponent(
    pathUtils.normalizePath(
      // normalize like /foo/bar
      absoluteUrl.pathname,
    ),
  );
};

// resolve pagePath
//   when `fromPagePath`=/hoge and `specifiedPath`=./fuga,
//        `pagePath` to be /hoge/fuga
//   when `fromPagePath`=/hoge and `specifiedPath`=/fuga,
//        `pagePath` to be /fuga
//   when `fromPagePath`=/hoge and `specifiedPath`=undefined,
//        `pagePath` to be /hoge
const resolvePath = (pagePath: string, basePath: string) => {
  const baseUrl = new URL(
    pathUtils.addTrailingSlash(basePath),
    'https://example.com',
  );
  const absoluteUrl = new URL(pagePath, baseUrl);
  return decodeURIComponent(absoluteUrl.pathname);
};

type RefRehypePluginParams = {
  pagePath?: string;
};

export const rehypePlugin: Plugin<[RefRehypePluginParams]> = (options = {}) => {
  if (options.pagePath == null) {
    throw new Error("refs rehype plugin requires 'pagePath' option");
  }

  return (tree) => {
    if (options.pagePath == null) {
      return;
    }

    const basePagePath = options.pagePath;
    const elements = selectAll(
      'ref, refimg, refs, refsimg, gallery',
      tree as HastNode,
    );

    for (const refElem of elements) {
      if (refElem.properties == null) {
        continue;
      }

      const prefix = refElem.properties.prefix;
      // set basePagePath when prefix is undefined or invalid
      if (prefix != null && typeof prefix === 'string') {
        refElem.properties.prefix = resolvePath(prefix, basePagePath);
      }

      refElem.properties.pagePath = refElem.properties.page;
      const pagePath = refElem.properties.pagePath;

      // set basePagePath when pagePath is undefined or invalid
      if (pagePath == null || typeof pagePath !== 'string') {
        refElem.properties.pagePath = basePagePath;
        continue;
      }

      // return when page is already determined and absolute path
      if (pathUtils.hasHeadingSlash(pagePath)) {
        continue;
      }

      // resolve relative path
      refElem.properties.pagePath = getAbsolutePathFor(pagePath, basePagePath);
    }
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['ref', 'refimg', 'refs', 'refsimg', 'gallery'],
  attributes: {
    ref: REF_SUPPORTED_ATTRIBUTES,
    refimg: REF_IMG_SUPPORTED_ATTRIBUTES,
    refs: REFS_SUPPORTED_ATTRIBUTES,
    refsimg: REFS_IMG_SUPPORTED_ATTRIBUTES,
    gallery: REFS_IMG_SUPPORTED_ATTRIBUTES,
  },
};
