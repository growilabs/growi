import { fromMarkdown, toMarkdown } from 'mdast-util-wiki-link';
import { syntax } from 'micromark-extension-wiki-link';
import type { Plugin } from 'unified';

type FromMarkdownExtension = {
  enter: {
    wikiLink: (token: string) => void;
  };
  exit: {
    wikiLinkTarget: (token: string) => void;
    wikiLinkAlias: (token: string) => void;
    wikiLink: (token: string) => void;
  };
};

type FromMarkdownData = {
  value: string | null;
  data: {
    alias: string | null;
    hProperties: Record<string, unknown>;
  };
};

function swapTargetAndAlias(
  fromMarkdownExtension: FromMarkdownExtension,
): FromMarkdownExtension {
  return {
    enter: fromMarkdownExtension.enter,
    exit: {
      wikiLinkTarget: fromMarkdownExtension.exit.wikiLinkTarget,
      wikiLinkAlias: fromMarkdownExtension.exit.wikiLinkAlias,
      wikiLink(token: string) {
        const wikiLink: FromMarkdownData = this.stack[this.stack.length - 1];

        // swap target and alias
        //    The default Wiki Link behavior: [[${target}${aliasDivider}${alias}]]
        //    After swapping:                 [[${alias}${aliasDivider}${target}]]
        const target = wikiLink.value;
        const alias = wikiLink.data.alias;
        if (target != null && alias != null) {
          wikiLink.value = alias;
          wikiLink.data.alias = target;
        }

        // invoke original wikiLink method
        const orgWikiLink = fromMarkdownExtension.exit.wikiLink.bind(this);
        orgWikiLink(token);
      },
    },
  };
}

/**
 * Implemented with reference to https://github.com/landakram/remark-wiki-link/blob/master/src/index.js
 */
export const pukiwikiLikeLinker: Plugin = function () {
  const data = this.data();

  function add(field: string, value) {
    if (data[field] != null) {
      const array = data[field];
      if (Array.isArray(array)) {
        array.push(value);
      }
    } else {
      data[field] = [value];
    }
  }

  add(
    'micromarkExtensions',
    syntax({
      aliasDivider: '>',
    }),
  );
  add(
    'fromMarkdownExtensions',
    swapTargetAndAlias(
      fromMarkdown({
        wikiLinkClassName: 'pukiwiki-like-linker',
        newClassName: ' ',
        pageResolver: (value) => [value],
        hrefTemplate: (permalink) => permalink,
      }),
    ),
  );
  add('toMarkdownExtensions', toMarkdown({}));
};
