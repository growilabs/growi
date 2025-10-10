import emojiData from '@emoji-mart/data/sets/15/native.json';
import type { Root } from 'mdast';
import { findAndReplace } from 'mdast-util-find-and-replace';
import type { Plugin } from 'unified';

export const remarkPlugin: Plugin = () => {
  return (tree: Root) => {
    findAndReplace(tree, [
      // Ref: https://github.com/remarkjs/remark-gemoji/blob/fb4d8a5021f02384e180c17f72f40d8dc698bd46/lib/index.js
      /:(\+1|[-\w]+):/g,

      (_, $1: string) => {
        const emoji = emojiData.emojis[$1]?.skins[0].native;
        return emoji ?? false;
      },
    ]);
  };
};
