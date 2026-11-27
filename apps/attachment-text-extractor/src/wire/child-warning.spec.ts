import {
  CHILD_WARNING_CODES,
  decodeChildWarnings,
  encodeChildWarning,
  MAX_CHILD_WARNING_BYTES,
} from './child-warning';

// What the parent makes of a child's standard error: codes from the closed
// set, and one flag for everything else. The child is untrusted, so nothing
// of the bytes themselves may come back.

const bytes = (text: string): Buffer => Buffer.from(text, 'latin1');

describe('decodeChildWarnings', () => {
  it.each(
    CHILD_WARNING_CODES,
  )('reads back %s as the child encodes it', (code) => {
    expect(decodeChildWarnings(bytes(encodeChildWarning(code)), false)).toEqual(
      { codes: [code], unrecognised: false },
    );
  });

  it('reads nothing from an empty standard error', () => {
    expect(decodeChildWarnings(Buffer.alloc(0), false)).toEqual({
      codes: [],
      unrecognised: false,
    });
  });

  it('keeps each code once, in the order of first appearance', () => {
    const text = 'result_not_sent\noom_score_not_raised\nresult_not_sent\n';

    expect(decodeChildWarnings(bytes(text), false)).toEqual({
      codes: ['result_not_sent', 'oom_score_not_raised'],
      unrecognised: false,
    });
  });

  it.each([
    ['an unknown line', 'no_such_code\n'],
    ['a code with a trailing space', 'result_not_sent \n'],
    ['a code in another case', 'RESULT_NOT_SENT\n'],
    ['a code after a carriage return', 'x\rresult_not_sent\n'],
    ['a code with an ANSI escape', '\x1b[31mresult_not_sent\x1b[0m\n'],
    ['an empty line', '\n'],
    ['a code without its line end', 'result_not_sent'],
    ['a prototype key', 'constructor\n'],
  ])('flags %s as unrecognised and reports no code for it', (_case, text) => {
    expect(decodeChildWarnings(bytes(text), false)).toEqual({
      codes: [],
      unrecognised: true,
    });
  });

  it('reports the known codes next to the flag', () => {
    const text = 'oom_score_not_raised\nsomething else\n';

    expect(decodeChildWarnings(bytes(text), false)).toEqual({
      codes: ['oom_score_not_raised'],
      unrecognised: true,
    });
  });

  it('flags bytes dropped over the cap as unrecognised', () => {
    expect(
      decodeChildWarnings(bytes(encodeChildWarning('result_not_sent')), true),
    ).toEqual({ codes: ['result_not_sent'], unrecognised: true });
  });

  it('can never report more than the closed set', () => {
    const everything = CHILD_WARNING_CODES.map(encodeChildWarning).join('');

    expect(everything.length).toBeLessThanOrEqual(MAX_CHILD_WARNING_BYTES);
    expect(
      decodeChildWarnings(bytes(everything.repeat(3)), false).codes,
    ).toEqual([...CHILD_WARNING_CODES]);
  });
});
