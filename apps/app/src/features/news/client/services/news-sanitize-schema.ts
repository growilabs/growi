import type { Schema } from 'hast-util-sanitize';

/**
 * News-only sanitize schema for rehype-sanitize.
 *
 * hast-util-sanitize shallow-merges this over its `defaultSchema`
 * (`{...defaultSchema, ...schema}`), so `tagNames`, `attributes` and
 * `protocols` below fully REPLACE the defaults — yielding the intended minimum
 * surface (basic formatting + same-origin images only), not GROWI's Wiki
 * `recommended-whitelist`. See design.md Security Considerations.
 *
 * `strip: null` is load-bearing. When a disallowed element is met,
 * hast-util-sanitize drops it with its children only when `strip` is falsy;
 * with any array (including the inherited `defaultSchema.strip = ['script']`)
 * it *unwraps* every disallowed element not named in the list, keeping its
 * children — which would leak e.g. a GFM footnote section's heading and list.
 * Omitting `strip` would inherit that default and reintroduce the leak, so it
 * is set to null explicitly. Every tag remark-gfm can emit that we want to keep
 * MUST therefore be listed here (tables in particular) or it vanishes silently.
 */
export const newsSanitizeSchema: Schema = {
  // Headings are allowed h1–h6 but shifted down 2 levels before sanitize (see
  // news-markdown-options) so body headings sit under the <h2> news title.
  tagNames: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'a',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  attributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
  },
  // Attribute-keyed (hast-util-sanitize applies protocols per attribute name,
  // not per tag). `href` appears only on <a>, `src` only on <img>, so this
  // yields: links = http/https/mailto, images = https only.
  protocols: {
    href: ['http', 'https', 'mailto'],
    src: ['https'],
  },
  // Drop every disallowed element together with its children (see the module
  // comment). Must be null, not omitted (would inherit defaultSchema's
  // ['script']) and not [] (a truthy array still triggers unwrap).
  strip: null,
};
