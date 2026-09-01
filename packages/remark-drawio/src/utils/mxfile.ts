/**
 * The multi-page draw.io storage format (see #11522).
 *
 * A draw.io document may hold several <diagram> elements (one per page/tab).
 * When more than one page exists it is persisted as a self-contained <mxfile>
 * wrapping every <diagram>; the render side detects that shape and passes it
 * through untouched. Building the format (`extractDrawioData`) and detecting it
 * (`isMxfileData`) live together here so the two halves cannot drift apart.
 */

const mxfileRegexp = /^<mxfile[\s>]/;

/**
 * Whether the stored drawio code is a full <mxfile> (multi-page format) rather
 * than a single diagram's inner XML (legacy single-page format).
 */
export const isMxfileData = (input: string): boolean => {
  return mxfileRegexp.test(input.trim());
};

/**
 * Build the string to persist in the ```drawio markdown block from the raw
 * <mxfile> XML that the draw.io editor posts on save.
 *
 * Keeping only the first <diagram> silently discarded pages 2..N (#11522). For
 * multiple pages a self-contained <mxfile> wrapping every <diagram> (name/id
 * preserved) is persisted, so no page is lost and reopening the editor restores
 * all of them. The single-page case keeps the previous representation — the
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
