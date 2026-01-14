/**
 * return markdown where the drawioData specified by line number params is replaced to the drawioData specified by drawioData param
 */
export const replaceDrawioInMarkdown = (
  drawioData: string,
  markdown: string,
  beginLineNumber: number,
  endLineNumber: number,
): string => {
  const splitMarkdown = markdown.split(/\r\n|\r|\n/);
  const markdownBeforeDrawio = splitMarkdown.slice(0, beginLineNumber - 1);
  const markdownAfterDrawio = splitMarkdown.slice(endLineNumber);

  let newMarkdown = '';
  if (markdownBeforeDrawio.length > 0) {
    newMarkdown += `${markdownBeforeDrawio.join('\n')}\n`;
  }
  newMarkdown += '``` drawio\n';
  newMarkdown += drawioData;
  newMarkdown += '\n```';
  if (markdownAfterDrawio.length > 0) {
    newMarkdown += `\n${markdownAfterDrawio.join('\n')}`;
  }

  return newMarkdown;
};
