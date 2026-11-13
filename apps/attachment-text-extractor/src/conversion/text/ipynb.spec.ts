import { encodeText, JAPANESE_SAMPLE } from '../../../test/fixtures';
import { IPYNB_OUTPUT_MAX_CHARS, ipynbToText } from './ipynb';

const nb = (notebook: unknown, cap: number = IPYNB_OUTPUT_MAX_CHARS): string =>
  ipynbToText(Buffer.from(JSON.stringify(notebook)), cap);

const notebook = (cells: readonly unknown[]) => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells,
});

describe('ipynbToText (test_text.py, ipynb)', () => {
  it('extracts sources and text outputs', () => {
    const out = nb(
      notebook([
        { cell_type: 'markdown', source: ['# Title\n', 'intro'] },
        {
          cell_type: 'code',
          source: "print('hi')",
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['hi\n'] },
            { output_type: 'execute_result', data: { 'text/plain': '42' } },
          ],
        },
      ]),
    );
    expect(out).toBe("# Title\nintro\nprint('hi')\nhi\n42");
  });

  it('drops images and non-text MIME types', () => {
    const out = nb(
      notebook([
        {
          cell_type: 'code',
          source: 'plot()',
          outputs: [
            {
              output_type: 'display_data',
              data: {
                'image/png': 'iVBORw0KGgoBASE64DATA',
                'application/json': { k: 'JSONDATA' },
                'text/html': '<b>HTMLDATA</b>',
                'text/plain': '<Figure>',
              },
            },
          ],
        },
      ]),
    );
    expect(out).toBe('plot()\n<Figure>');
  });

  it('caps each output but not the sources', () => {
    const out = nb(
      notebook([
        {
          cell_type: 'code',
          source: 's'.repeat(50),
          outputs: [
            { output_type: 'stream', text: 'a'.repeat(50) },
            {
              output_type: 'execute_result',
              data: { 'text/plain': ['b'.repeat(30), 'b'.repeat(30)] },
            },
          ],
        },
      ]),
      20,
    );
    expect(out).toBe(
      ['s'.repeat(50), 'a'.repeat(20), 'b'.repeat(20)].join('\n'),
    );
  });

  it('reads nbformat 3 input and pyout', () => {
    const out = nb({
      nbformat: 3,
      worksheets: [
        {
          cells: [
            {
              cell_type: 'code',
              input: ['x = 1'],
              outputs: [{ output_type: 'pyout', text: ['1'] }],
            },
            { cell_type: 'markdown', source: 'note' },
          ],
        },
      ],
    });
    expect(out).toBe('x = 1\n1\nnote');
  });

  it('tolerates malformed cells and outputs', () => {
    const out = nb(
      notebook([
        'not a dict',
        null,
        { cell_type: 'code', source: 5, outputs: 'nope' },
        {
          cell_type: 'code',
          source: [1, 'ok'],
          outputs: [null, { output_type: 'stream', text: 3 }],
        },
        {
          cell_type: 'code',
          source: 'tail',
          outputs: [{ output_type: 'display_data', data: [] }],
        },
      ]),
    );
    expect(out).toBe('ok\ntail');
  });

  it('takes nothing from error outputs', () => {
    const error = {
      output_type: 'error',
      traceback: ['\x1b[31mZeroDivisionError'],
    };
    expect(
      nb(notebook([{ cell_type: 'code', source: '1/0', outputs: [error] }])),
    ).toBe('1/0');
  });

  it('falls back to the plain text for invalid JSON', () => {
    expect(
      ipynbToText(Buffer.from('{"cells": [ broken'), IPYNB_OUTPUT_MAX_CHARS),
    ).toBe('{"cells": [ broken');
  });

  it('falls back to the plain text for valid JSON that is not a notebook', () => {
    expect(ipynbToText(Buffer.from('["a", "b"]'), IPYNB_OUTPUT_MAX_CHARS)).toBe(
      '["a", "b"]',
    );
  });

  it('falls back to the plain text for deeply nested JSON without overflowing the stack', () => {
    const nested = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
    expect(ipynbToText(Buffer.from(nested), IPYNB_OUTPUT_MAX_CHARS)).toBe(
      nested,
    );
  });

  it('decodes a Shift_JIS notebook', () => {
    const data = encodeText(
      JSON.stringify(
        notebook([{ cell_type: 'markdown', source: JAPANESE_SAMPLE }]),
      ),
      'shift_jis',
    );
    expect(ipynbToText(data, IPYNB_OUTPUT_MAX_CHARS)).toBe(JAPANESE_SAMPLE);
  });

  it('never lets a lone surrogate reach the result', () => {
    const out = nb(
      notebook([
        {
          cell_type: 'code',
          source: '\ud800x',
          outputs: [{ output_type: 'stream', text: '\udfffy' }],
        },
      ]),
    );
    expect(out.isWellFormed()).toBe(true);
  });

  it('turns a lone surrogate into the replacement character', () => {
    expect(nb(notebook([{ cell_type: 'code', source: '\ud800x' }]))).toBe(
      '\ufffdx',
    );
  });
});
