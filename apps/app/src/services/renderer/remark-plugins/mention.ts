import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { PhrasingContent, Root } from 'mdast';
import { findAndReplace } from 'mdast-util-find-and-replace';
import type { Plugin } from 'unified';

const MENTION_REGEX = /\B@([\w@.-]+)/g;

export const remarkPlugin: Plugin = () => {
  return (tree: Root) => {
    try {
      findAndReplace(
        tree,
        [
          MENTION_REGEX,
          (_match: string, username: string) =>
            ({
              type: 'mention',
              data: {
                hName: 'span',
                hProperties: {
                  className: ['mention-user'],
                  'data-mention': username,
                },
              },
              children: [{ type: 'text', value: _match }],
            }) as unknown as PhrasingContent,
        ],
        { ignore: 'mention' },
      );
    } catch {
      // Fail gracefully so comment rendering is never broken by this plugin
    }
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['span'],
  attributes: {
    span: ['className', 'data-mention'],
  },
};
