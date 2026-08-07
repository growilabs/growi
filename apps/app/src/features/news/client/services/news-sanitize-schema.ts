import type { Schema } from 'hast-util-sanitize';

/**
 * News-only sanitize schema for rehype-sanitize.
 *
 * Deliberately zero-based (does NOT extend hast-util-sanitize's defaultSchema
 * nor GROWI's Wiki `recommended-whitelist`): news body is vendor-authored and
 * fan-out to every instance, so it gets the minimum surface — basic formatting
 * + same-origin images only. See design.md Security Considerations.
 *
 * hast-util-sanitize removes a disallowed element together with its children
 * when `strip` does not name it, so every tag remark-gfm can emit that we want
 * to keep MUST be listed here (tables in particular) or it vanishes silently.
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
  // Fully drop these (with their content) rather than unwrapping to text.
  strip: ['script', 'style'],
  clobberPrefix: 'news-',
};
