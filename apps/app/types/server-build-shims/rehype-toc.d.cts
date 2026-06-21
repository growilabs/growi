// Runtime: `module.exports` is the toc plugin function (self-patched).

import type {
  HtmlElementNode as OrigHtmlElementNode,
  Options as OrigOptions,
} from '@jsdevtools/rehype-toc';
import Orig from '@jsdevtools/rehype-toc';

declare const toc: typeof Orig;
declare namespace toc {
  type HtmlElementNode = OrigHtmlElementNode;
  type Options = OrigOptions;
}
export = toc;
