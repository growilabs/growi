/**
 * Build the string to persist in the ```drawio markdown block from the raw
 * <mxfile> XML that the draw.io editor posts on save.
 *
 * A draw.io document may hold several <diagram> elements (one per page/tab).
 * Keeping only the first one silently discarded pages 2..N (see #11522). When
 * more than one page exists, a self-contained <mxfile> wrapping every <diagram>
 * (its name/id preserved) is persisted instead, so no page is lost and
 * reopening the editor restores all of them.
 *
 * The single-page case intentionally keeps the previous representation — the
 * first diagram's innerHTML — so existing pages serialize to identical markdown.
 */
export const extractDrawioData = (rawMxfileXml: string): string => {
  const dom = new DOMParser().parseFromString(rawMxfileXml, 'text/xml');
  const diagrams = dom.getElementsByTagName('diagram');

  if (diagrams.length === 0) {
    return '';
  }
  if (diagrams.length === 1) {
    return diagrams[0].innerHTML;
  }

  const serializer = new XMLSerializer();
  const diagramsXml = Array.from(diagrams)
    .map((diagram) => serializer.serializeToString(diagram))
    .join('\n');
  return `<mxfile>\n${diagramsXml}\n</mxfile>`;
};
