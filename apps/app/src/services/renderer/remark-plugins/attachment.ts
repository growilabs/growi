import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Link } from 'mdast';
import path from 'path';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const SUPPORTED_ATTRIBUTES = ['attachmentId', 'url', 'attachmentName'];

const isAttachmentLink = (url: string): boolean => {
  // https://regex101.com/r/9qZhiK/1
  const attachmentUrlFormat = new RegExp(/^\/(attachment)\/([^/^\n]+)$/);
  return attachmentUrlFormat.test(url);
};

const rewriteNode = (node: Link) => {
  const attachmentId = path.basename(node.url);
  const attachmentName =
    node.children[0] != null && node.children[0].type === 'text'
      ? node.children[0].value
      : '';

  if (node.data == null) {
    node.data = {};
  }
  const data = node.data;
  data.hName = 'attachment';
  data.hProperties = {
    attachmentId,
    url: node.url,
    attachmentName,
  };
};

export const remarkPlugin: Plugin = () => {
  return (tree) => {
    visit(tree, 'link', (node: Link) => {
      if (isAttachmentLink(node.url)) {
        rewriteNode(node);
      }
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['attachment'],
  attributes: {
    attachment: SUPPORTED_ATTRIBUTES,
  },
};
