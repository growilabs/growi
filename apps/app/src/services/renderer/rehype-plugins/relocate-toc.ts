import type { HtmlElementNode } from 'rehype-toc';
import rehypeToc from 'rehype-toc';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

type StoreTocPluginParams = {
  storeTocNode: (toc: HtmlElementNode) => void;
};

export const rehypePluginStore: Plugin<[StoreTocPluginParams]> = (options) => {
  return rehypeToc.bind(this)({
    nav: false,
    headings: ['h1', 'h2', 'h3'],
    customizeTOC: (toc: HtmlElementNode) => {
      // For storing tocNode to global state with swr
      // search: tocRef.current
      options.storeTocNode(toc);

      return false; // not show toc in body
    },
  });
};

// method for replace <ol> to <ul>
const replaceOlToUl = (tree: HtmlElementNode) => {
  visit(tree, 'element', (node: HtmlElementNode) => {
    if (node.tagName === 'ol') {
      node.tagName = 'ul';
    }
  });
};

type RestoreTocPluginParams = {
  tocNode?: HtmlElementNode;
};

export const rehypePluginRestore: Plugin<[RestoreTocPluginParams]> = (
  options,
) => {
  const { tocNode } = options;

  return rehypeToc.bind(this)({
    headings: ['h1', 'h2', 'h3'],
    customizeTOC: () => {
      if (tocNode != null) {
        replaceOlToUl(tocNode); // replace <ol> to <ul>

        // restore toc
        return tocNode;
      }
    },
  });
};
