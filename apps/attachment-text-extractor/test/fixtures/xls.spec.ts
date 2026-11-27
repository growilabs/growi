import CFB from 'cfb';

import { anydocMarkdown } from './spec-support';
import { buildXls } from './xls';

const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const BIFF8_BOF = 0x0809;
const BIFF8_VERSION = 0x0600;
const WORKBOOK_GLOBALS = 0x0005;

const TWO_SHEETS = [
  { name: 'First', rows: [['XLS cell marker', 42]] },
  { name: 'Second', rows: [['second sheet']] },
];

const workbookStream = (xls: Buffer): Buffer => {
  const entry = CFB.find(CFB.read(xls, { type: 'buffer' }), 'Workbook');
  if (entry == null) {
    throw new Error('no Workbook stream');
  }
  return Buffer.from(entry.content);
};

describe('buildXls', () => {
  it('writes an OLE file holding a BIFF8 Workbook stream', () => {
    const xls = buildXls(TWO_SHEETS);

    const stream = workbookStream(xls);

    expect(xls.subarray(0, 8)).toEqual(OLE_MAGIC);
    expect(stream.readUInt16LE(0)).toBe(BIFF8_BOF);
    expect(stream.readUInt16LE(4)).toBe(BIFF8_VERSION);
    expect(stream.readUInt16LE(6)).toBe(WORKBOOK_GLOBALS);
  });

  it('stores sheet names and strings as 8-bit text, as xlwt does', () => {
    const stream = workbookStream(buildXls(TWO_SHEETS));

    for (const text of ['First', 'Second', 'XLS cell marker']) {
      expect(stream.includes(Buffer.from(text, 'latin1'))).toBe(true);
    }
  });

  it('writes sheets and cells that anydoc reads', async () => {
    const markdown = await anydocMarkdown(buildXls(TWO_SHEETS), 'xlsx');

    expect(markdown).toBe(
      '## First\n\n|  |  |\n| --- | --- |\n| XLS cell marker | 42 |\n\n' +
        '## Second\n\n|  |\n| --- |\n| second sheet |\n',
    );
  });

  it('writes Japanese sheet names and cells that anydoc reads, as xlwt does', async () => {
    const xls = buildXls([
      { name: '売上', rows: [['日本語の値', 42], ['café']] },
      { name: 'Summary', rows: [['ascii only']] },
    ]);

    const stream = workbookStream(xls);

    // Expected Markdown is what anydoc returns for the same workbook written
    // by xlwt (Python), recorded 2026-11-04.
    expect(await anydocMarkdown(xls, 'xlsx')).toBe(
      '## 売上\n\n| 日本語の値 | 42 |\n| --- | --- |\n| café |  |\n\n' +
        '## Summary\n\n|  |\n| --- |\n| ascii only |\n',
    );
    expect(stream.includes(Buffer.from('売上', 'utf16le'))).toBe(true);
    expect(stream.includes(Buffer.from('café', 'latin1'))).toBe(true);
  });
});
