import type { JSX } from 'react';
import { useState } from 'react';
import type { Element, Root } from 'hast';
import type { Components, Options } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

import { newsSanitizeSchema } from './news-sanitize-schema';
import { rehypeResolveNewsMedia } from './rehype-resolve-news-media';

const MAX_IMAGE_HEIGHT_PX = 400;

/**
 * Shift body headings down 2 levels (h1→h3 … capped at h6) so they nest under
 * the <h2> news title on /_news. sanitize allows h1–h6, so ordering relative
 * to sanitize is irrelevant; runs before it for clarity.
 */
const rehypeShiftNewsHeadings = () => {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      const match = /^h([1-6])$/.exec(node.tagName);
      if (match != null) {
        node.tagName = `h${Math.min(6, Number(match[1]) + 2)}`;
      }
    });
  };
};

/**
 * Image slot for news Markdown. `src` is already an absolute, validated URL
 * (rehypeResolveNewsMedia rewrote it; sanitize enforced https). A load failure
 * hides only this image. React may reuse this component instance when the
 * body changes and only `src` differs (same tree position), so the error
 * state is reset whenever `src` changes — otherwise a previously-failed slot
 * would keep hiding a new, valid image.
 */
const NewsMarkdownImage = ({
  src,
  alt,
  title,
}: JSX.IntrinsicElements['img']): JSX.Element | null => {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  if (typeof src !== 'string') {
    return null;
  }
  if (erroredSrc === src) {
    return null;
  }
  return (
    // biome-ignore lint/performance/noImgElement: hotlink to the feed origin; next/image would proxy the vendor image through this GROWI server, defeating the design
    <img
      src={src}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="mw-100 rounded"
      style={{ maxHeight: `${MAX_IMAGE_HEIGHT_PX}px`, maxWidth: '100%' }}
      onError={() => setErroredSrc(src)}
    />
  );
};

const EXTERNAL_HREF_PATTERN = /^https?:\/\//;

const NewsMarkdownAnchor = ({
  href,
  children,
}: JSX.IntrinsicElements['a']): JSX.Element => {
  // Only external http(s) links open in a new tab. Fragment / mailto links —
  // and links whose href was stripped by sanitize (href undefined) — stay in
  // the same tab; otherwise a blank-target fragment would open a new tab to a
  // non-existent anchor (id attributes are not in the allow-list).
  const isExternal =
    typeof href === 'string' && EXTERNAL_HREF_PATTERN.test(href);
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
};

const components: Components = {
  img: NewsMarkdownImage,
  a: NewsMarkdownAnchor,
};

/**
 * react-markdown options for the news-only restricted renderer.
 * - remark: gfm (tables/strikethrough/autolink) + breaks
 * - rehype: heading shift → media resolve+containment → sanitize (news schema)
 * - NO rehype-raw: raw HTML in body is never parsed (Req 2.2)
 */
export const newsMarkdownOptions: Options = {
  remarkPlugins: [remarkGfm, remarkBreaks],
  rehypePlugins: [
    rehypeShiftNewsHeadings,
    rehypeResolveNewsMedia,
    [rehypeSanitize, newsSanitizeSchema],
  ],
  components,
};
