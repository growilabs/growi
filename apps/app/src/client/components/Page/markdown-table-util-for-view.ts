import { MarkdownTable } from '@growi/editor';

export const getMarkdownTableFromLine = (
  markdown: string,
  bol: number,
  eol: number,
): MarkdownTable => {
  const tableLines = markdown
    .split(/\r\n|\r|\n/)
    .slice(bol - 1, eol)
    .join('\n');
  return MarkdownTable.fromMarkdownString(tableLines);
};

/**
 * return markdown where the markdown table specified by line number params is replaced to the markdown table specified by table param
 */
export const replaceMarkdownTableInMarkdown = (
  table: MarkdownTable,
  markdown: string,
  beginLineNumber: number,
  endLineNumber: number,
): string => {
  const splitMarkdown = markdown.split(/\r\n|\r|\n/);
  const markdownBeforeTable = splitMarkdown.slice(0, beginLineNumber - 1);
  const markdownAfterTable = splitMarkdown.slice(endLineNumber);

  let newMarkdown = '';
  if (markdownBeforeTable.length > 0) {
    newMarkdown += `${markdownBeforeTable.join('\n')}\n`;
  }
  newMarkdown += table;
  if (markdownAfterTable.length > 0) {
    newMarkdown += `\n${markdownAfterTable.join('\n')}`;
  }

  return newMarkdown;
};
