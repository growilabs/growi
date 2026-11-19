import {
  contentTypesXml,
  DRAWINGML_NS,
  type OoxmlPart,
  packageRelationshipsPart,
  RELATIONSHIPS_NS,
  relationshipsXml,
  XML_DECLARATION,
} from './ooxml-package';
import { escapeXml } from './xml-text';
import { buildZip } from './zip';

/** A formula with the string value Excel cached for it, as openpyxl writes it. */
export interface XlsxFormulaCell {
  readonly formula: string;
  readonly cached: string;
}

export type XlsxCell = string | number | XlsxFormulaCell;
export type XlsxSheetState = 'visible' | 'hidden' | 'veryHidden';

export interface XlsxWorksheet {
  readonly name: string;
  /** A sheet without rows has no cells at all. */
  readonly rows?: readonly (readonly XlsxCell[])[];
  readonly state?: XlsxSheetState;
}

/** A bar chart over ranges of another sheet, e.g. `$B$2:$B$4`. */
export interface XlsxChart {
  readonly dataSheet: string;
  readonly categories: string;
  readonly values: string;
}

export interface XlsxChartsheet {
  readonly name: string;
  readonly chart: XlsxChart;
  readonly state?: XlsxSheetState;
}

export type XlsxSheet = XlsxWorksheet | XlsxChartsheet;

export interface XlsxDefinedName {
  readonly name: string;
  /** The formula text, e.g. `'Alpha'!$1:$1`. */
  readonly text: string;
  /** Scopes the name to the sheet at this 0-based position. */
  readonly localSheetId?: number;
}

export interface XlsxOptions {
  readonly definedNames?: readonly XlsxDefinedName[];
}

const SML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const OFFICE = 'application/vnd.openxmlformats-officedocument';

interface SheetParts {
  readonly parts: OoxmlPart[];
  readonly overrides: (readonly [string, string])[];
  readonly relationshipType: string;
  readonly target: string;
}

const columnName = (index: number): string => {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : columnName(Math.floor(index / 26) - 1) + letter;
};

// Strings are written inline (t="inlineStr"), so no sharedStrings part is needed.
const cellXml = (value: XlsxCell, ref: string): string => {
  if (typeof value === 'number') {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === 'string') {
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }
  return `<c r="${ref}" t="str"><f>${escapeXml(value.formula)}</f><v>${escapeXml(value.cached)}</v></c>`;
};

const worksheetXml = (rows: readonly (readonly XlsxCell[])[]): string => {
  const body = rows
    .map((row, r) => {
      const cells = row.map((value, c) =>
        cellXml(value, `${columnName(c)}${r + 1}`),
      );
      return `<row r="${r + 1}">${cells.join('')}</row>`;
    })
    .join('');
  return `${XML_DECLARATION}<worksheet xmlns="${SML_NS}"><sheetData>${body}</sheetData></worksheet>`;
};

const worksheetParts = (sheet: XlsxWorksheet, n: number): SheetParts => ({
  parts: [
    {
      name: `xl/worksheets/sheet${n}.xml`,
      data: worksheetXml(sheet.rows ?? []),
    },
  ],
  overrides: [[`/xl/worksheets/sheet${n}.xml`, `${SML}.worksheet+xml`]],
  relationshipType: 'worksheet',
  target: `worksheets/sheet${n}.xml`,
});

const drawingXml = (): string =>
  `${XML_DECLARATION}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${DRAWINGML_NS}"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9000000" cy="6000000"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${CHART_NS}"><c:chart xmlns:c="${CHART_NS}" xmlns:r="${RELATIONSHIPS_NS}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`;

const chartXml = ({ dataSheet, categories, values }: XlsxChart): string => {
  const ref = (range: string) => `'${escapeXml(dataSheet)}'!${range}`;
  const axes =
    '<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="100"/></c:catAx>' +
    '<c:valAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="10"/></c:valAx>';
  const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>${ref(categories)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${ref(values)}</c:f></c:numRef></c:val></c:ser>`;
  return `${XML_DECLARATION}<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${DRAWINGML_NS}"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series}<c:axId val="10"/><c:axId val="100"/></c:barChart>${axes}</c:plotArea></c:chart></c:chartSpace>`;
};

// A chart-only sheet: chartsheet -> drawing -> chart.
const chartsheetParts = (sheet: XlsxChartsheet, n: number): SheetParts => ({
  parts: [
    {
      name: `xl/chartsheets/sheet${n}.xml`,
      data: `${XML_DECLARATION}<chartsheet xmlns="${SML_NS}" xmlns:r="${RELATIONSHIPS_NS}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><drawing r:id="rId1"/></chartsheet>`,
    },
    {
      name: `xl/chartsheets/_rels/sheet${n}.xml.rels`,
      data: relationshipsXml([
        { id: 'rId1', type: 'drawing', target: `../drawings/drawing${n}.xml` },
      ]),
    },
    { name: `xl/drawings/drawing${n}.xml`, data: drawingXml() },
    {
      name: `xl/drawings/_rels/drawing${n}.xml.rels`,
      data: relationshipsXml([
        { id: 'rId1', type: 'chart', target: `../charts/chart${n}.xml` },
      ]),
    },
    { name: `xl/charts/chart${n}.xml`, data: chartXml(sheet.chart) },
  ],
  overrides: [
    [`/xl/chartsheets/sheet${n}.xml`, `${SML}.chartsheet+xml`],
    [`/xl/drawings/drawing${n}.xml`, `${OFFICE}.drawing+xml`],
    [`/xl/charts/chart${n}.xml`, `${OFFICE}.drawingml.chart+xml`],
  ],
  relationshipType: 'chartsheet',
  target: `chartsheets/sheet${n}.xml`,
});

const isChartsheet = (sheet: XlsxSheet): sheet is XlsxChartsheet =>
  'chart' in sheet;

// Worksheets and chartsheets are numbered separately, as Excel and openpyxl do.
const sheetPartsInOrder = (sheets: readonly XlsxSheet[]): SheetParts[] =>
  sheets.map((sheet, i) => {
    const sameKindSoFar = sheets
      .slice(0, i + 1)
      .filter((other) => isChartsheet(other) === isChartsheet(sheet)).length;
    return isChartsheet(sheet)
      ? chartsheetParts(sheet, sameKindSoFar)
      : worksheetParts(sheet, sameKindSoFar);
  });

// Every <sheet .../> is self-closing and carries `state`, as openpyxl writes it;
// the Python split tests rewrite these attributes with regexes (research.md 9.5.4).
const definedNamesXml = (names: readonly XlsxDefinedName[]): string => {
  if (names.length === 0) {
    return '';
  }
  const items = names.map(({ name, text, localSheetId }) => {
    const scope = localSheetId == null ? '' : ` localSheetId="${localSheetId}"`;
    return `<definedName name="${escapeXml(name)}"${scope}>${escapeXml(text)}</definedName>`;
  });
  return `<definedNames>${items.join('')}</definedNames>`;
};

const workbookXml = (
  sheets: readonly XlsxSheet[],
  definedNames: readonly XlsxDefinedName[],
): string => {
  const entries = sheets
    .map(
      (sheet, i) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" state="${sheet.state ?? 'visible'}" r:id="rId${i + 1}"/>`,
    )
    .join('');
  return `${XML_DECLARATION}<workbook xmlns="${SML_NS}" xmlns:r="${RELATIONSHIPS_NS}"><sheets>${entries}</sheets>${definedNamesXml(definedNames)}</workbook>`;
};

/** The parts of an XLSX workbook with the sheets in the given order. */
export const xlsxParts = (
  sheets: readonly XlsxSheet[],
  { definedNames = [] }: XlsxOptions = {},
): OoxmlPart[] => {
  const perSheet = sheetPartsInOrder(sheets);
  return [
    {
      name: '[Content_Types].xml',
      data: contentTypesXml({
        overrides: [
          ['/xl/workbook.xml', `${SML}.sheet.main+xml`],
          ...perSheet.flatMap((sheet) => sheet.overrides),
        ],
      }),
    },
    packageRelationshipsPart('xl/workbook.xml'),
    { name: 'xl/workbook.xml', data: workbookXml(sheets, definedNames) },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: relationshipsXml(
        perSheet.map((sheet, i) => ({
          id: `rId${i + 1}`,
          type: sheet.relationshipType,
          target: sheet.target,
        })),
      ),
    },
    ...perSheet.flatMap((sheet) => sheet.parts),
  ];
};

export const buildXlsx = (
  sheets: readonly XlsxSheet[],
  options: XlsxOptions = {},
): Buffer => buildZip(xlsxParts(sheets, options));
