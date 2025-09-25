/**
 * @typedef {import('mdast').Root} Root
 * @typedef {import('unified').Processor<Root>} Processor
 */

import {
  directiveFromMarkdown,
  directiveToMarkdown,
} from './mdast-util-growi-directive/index.js';
import { directive } from './micromark-extension-growi-directive/index.js';

/**
 * Plugin to support GROWI plugin (`$lsx(/path, depth=2)`).
 *
 * Add support for generic directives.
 *
 * ###### Notes
 *
 * Doesn’t handle the directives: create your own plugin to do that.
 *
 * @returns {undefined}
 *   Nothing.
 */
export function remarkGrowiDirectivePlugin() {
  // @ts-expect-error: TS is wrong about `this`.
  // biome-ignore lint/complexity/noUselessThisAlias: ignore
  const self = /** @type {Processor} */ (this);
  const data = self.data();

  if (!data.micromarkExtensions) data.micromarkExtensions = [];
  if (!data.fromMarkdownExtensions) data.fromMarkdownExtensions = [];
  if (!data.toMarkdownExtensions) data.toMarkdownExtensions = [];

  data.micromarkExtensions.push(directive());
  data.fromMarkdownExtensions.push(directiveFromMarkdown());
  data.toMarkdownExtensions.push(directiveToMarkdown());
}
