import { escapeXml } from './xml-text';

// Shape XML for the slides of buildPptx, in python-pptx's vocabulary.

const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';
const INCH = 914400;

const position = (x: number, y: number, cx: number, cy: number): string =>
  `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;

// "\n" starts a paragraph and "\v" breaks the line inside one, as
// python-pptx's text_frame.text does.
const paragraphXml = (line: string): string => {
  const runs = line
    .split('\v')
    .map((piece) => `<a:r><a:t>${escapeXml(piece)}</a:t></a:r>`)
    .join('<a:br/>');
  return `<a:p>${runs}</a:p>`;
};

export const paragraphsXml = (text: string): string =>
  text.split('\n').map(paragraphXml).join('');

export const shapeTree = (shapes: string): string =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;

// The title placeholder has no idx (= idx 0): python-pptx finds the slide
// title only there (research.md 9.3).
export const placeholderXml = (
  kind: 'title' | 'body',
  text: string,
): string => {
  const id = kind === 'title' ? 2 : 3;
  const ph = kind === 'title' ? '<p:ph type="title"/>' : '<p:ph idx="1"/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${kind} ${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphsXml(text)}</p:txBody></p:sp>`;
};

export const textboxXml = (id: number, text: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${position(INCH, 4 * INCH, 3 * INCH, INCH)}<a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr wrap="none"/><a:lstStyle/>${paragraphsXml(text)}</p:txBody></p:sp>`;

// Alt text keeps its newlines as character references inside the attribute.
export const pictureXml = (
  id: number,
  relationshipId: string,
  description: string,
): string => {
  const descr = escapeXml(description).replaceAll('\n', '&#10;');
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${descr}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${position(INCH, INCH, INCH, INCH)}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;
};

export const groupXml = (id: number, children: string): string =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${children}</p:grpSp>`;

const tableCellXml = (text: string): string =>
  `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphsXml(text)}</a:txBody><a:tcPr/></a:tc>`;

export const tableXml = (
  id: number,
  rows: readonly (readonly string[])[],
): string => {
  const columns = rows[0]?.length ?? 0;
  const grid = '<a:gridCol w="1828800"/>'.repeat(columns);
  const body = rows
    .map((row) => `<a:tr h="370840">${row.map(tableCellXml).join('')}</a:tr>`)
    .join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${INCH}" y="${2 * INCH}"/><a:ext cx="${4 * INCH}" cy="${2 * INCH}"/></p:xfrm><a:graphic><a:graphicData uri="${TABLE_URI}"><a:tbl><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};
