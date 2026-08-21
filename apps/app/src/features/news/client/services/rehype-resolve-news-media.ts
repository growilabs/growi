import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';

import { FEED_URL } from '../../consts';
import { resolveNewsMediaUrl } from '../../utils/resolve-news-media-url';

/**
 * rehype plugin: rewrite each `<img>` src from a feed-relative path to a
 * validated absolute URL. If the src cannot be resolved to a same-origin,
 * contained, https `images/<file>` URL, the whole `<img>` node is removed so
 * a single bad reference drops only its own image, not the surrounding body.
 *
 * Runs BEFORE rehype-sanitize; sanitize is the second gate on protocols/tags.
 */
export const rehypeResolveNewsMedia = () => {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'img' || parent == null || index == null) {
        return;
      }
      const src = node.properties?.src;
      const resolved =
        typeof src === 'string' ? resolveNewsMediaUrl(src, FEED_URL) : null;

      if (resolved == null) {
        parent.children.splice(index, 1);
        // re-visit the current index, which now holds the next sibling
        return index;
      }
      node.properties.src = resolved;
    });
  };
};
