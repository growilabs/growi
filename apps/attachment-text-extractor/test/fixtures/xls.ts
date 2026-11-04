import { startOffsets } from './offsets';
import { writeOle } from './ole';

// A minimal BIFF8 (Excel 97-2003) workbook. A string whose characters all fit
// in one byte is written as 8-bit characters, as xlwt does, so the Python
// fixture checks that look for ASCII sheet names and cell text in the file
// hold (research.md 9.4); any other string is written as UTF-16LE.

export type XlsCell = string | number;

export interface XlsSheet {
  readonly name: string;
  readonly rows: readonly (readonly XlsCell[])[];
}

const RECORD = {
  bof: 0x0809,
  eof: 0x000a,
  codepage: 0x0042,
  font: 0x0031,
  xf: 0x00e0,
  boundsheet: 0x0085,
  dimensions: 0x0200,
  number: 0x0203,
  label: 0x0204,
} as const;

const BIFF8_VERSION = 0x0600;
const SUBSTREAM = { workbookGlobals: 0x0005, worksheet: 0x0010 } as const;
const STYLE_XF_COUNT = 15;
// The first XF after the style XFs is the default cell format.
const CELL_XF_INDEX = STYLE_XF_COUNT;

const record = (type: number, body: Uint8Array = Buffer.alloc(0)): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(body.length, 2);
  return Buffer.concat([header, body]);
};

interface BiffString {
  /** Character count in UTF-16 code units. */
  readonly length: number;
  /** fHighByte: 0 for 8-bit characters, 1 for UTF-16LE. */
  readonly flags: number;
  readonly chars: Buffer;
}

const biffString = (text: string): BiffString => {
  const fitsInOneByte = [...text].every(
    (char) => (char.codePointAt(0) ?? 0) <= 0xff,
  );
  return fitsInOneByte
    ? { length: text.length, flags: 0, chars: Buffer.from(text, 'latin1') }
    : { length: text.length, flags: 1, chars: Buffer.from(text, 'utf16le') };
};

const bof = (substream: number): Buffer => {
  const body = Buffer.alloc(16);
  body.writeUInt16LE(BIFF8_VERSION, 0);
  body.writeUInt16LE(substream, 2);
  body.writeUInt16LE(0x0dbb, 4); // build
  body.writeUInt16LE(0x07cc, 6); // year
  return record(RECORD.bof, body);
};

const font = (): Buffer => {
  const body = Buffer.alloc(14);
  body.writeUInt16LE(200, 0); // height in twips
  body.writeUInt16LE(0x7fff, 4); // automatic colour
  body.writeUInt16LE(400, 6); // normal weight
  const name = Buffer.from('Arial', 'latin1');
  return record(
    RECORD.font,
    Buffer.concat([body, Buffer.from([name.length, 0]), name]),
  );
};

const xf = (isStyle: boolean): Buffer => {
  const body = Buffer.alloc(20);
  body.writeUInt16LE(isStyle ? 0xfff5 : 0x0001, 4);
  return record(RECORD.xf, body);
};

const cell = (value: XlsCell, row: number, column: number): Buffer => {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(row, 0);
  head.writeUInt16LE(column, 2);
  head.writeUInt16LE(CELL_XF_INDEX, 4);
  if (typeof value === 'number') {
    const number = Buffer.alloc(8);
    number.writeDoubleLE(value);
    return record(RECORD.number, Buffer.concat([head, number]));
  }
  const text = biffString(value);
  const length = Buffer.alloc(3); // character count + fHighByte
  length.writeUInt16LE(text.length, 0);
  length[2] = text.flags;
  return record(RECORD.label, Buffer.concat([head, length, text.chars]));
};

const sheetStream = (rows: XlsSheet['rows']): Buffer => {
  const dimensions = Buffer.alloc(14);
  dimensions.writeUInt32LE(rows.length, 4);
  dimensions.writeUInt16LE(Math.max(0, ...rows.map((row) => row.length)), 10);
  const cells = rows.flatMap((row, r) =>
    row.map((value, c) => cell(value, r, c)),
  );
  return Buffer.concat([
    bof(SUBSTREAM.worksheet),
    record(RECORD.dimensions, dimensions),
    ...cells,
    record(RECORD.eof),
  ]);
};

const boundsheet = (name: string, streamOffset: number): Buffer => {
  const text = biffString(name);
  const body = Buffer.alloc(8); // offset, visible worksheet, length, fHighByte
  body.writeUInt32LE(streamOffset, 0);
  body[6] = text.length;
  body[7] = text.flags;
  return record(RECORD.boundsheet, Buffer.concat([body, text.chars]));
};

const globalsPrefix = (): Buffer =>
  Buffer.concat([
    bof(SUBSTREAM.workbookGlobals),
    record(RECORD.codepage, Buffer.from([0xb0, 0x04])),
    ...Array.from({ length: 5 }, font),
    ...Array.from({ length: STYLE_XF_COUNT + 1 }, (_, i) =>
      xf(i < STYLE_XF_COUNT),
    ),
  ]);

/** Writes an XLS file: a `Workbook` stream in an OLE container. */
export const buildXls = (sheets: readonly XlsSheet[]): Buffer => {
  const prefix = globalsPrefix();
  const streams = sheets.map((sheet) => sheetStream(sheet.rows));
  // BOUNDSHEET records point at their sheet streams, so size them first.
  const boundsheetsSize = sheets
    .map((sheet) => boundsheet(sheet.name, 0).length)
    .reduce((a, b) => a + b, 0);
  const firstStreamAt =
    prefix.length + boundsheetsSize + record(RECORD.eof).length;
  const offsets = startOffsets(
    firstStreamAt,
    streams.map((stream) => stream.length),
  );
  const workbook = Buffer.concat([
    prefix,
    ...sheets.map((sheet, i) => boundsheet(sheet.name, offsets[i])),
    record(RECORD.eof),
    ...streams,
  ]);
  return writeOle([{ name: 'Workbook', content: workbook }]);
};
