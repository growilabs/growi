import {
  type ResultSkeleton,
  rejectUnsafeStructure,
} from './json-structure-guard';
import { WireProtocolError } from './wire-protocol-error';

// The key names of the real result, written out here on purpose: the bodies below are literal text.
const RESULT: ResultSkeleton = {
  topKeys: ['ok', 'pages', 'mimeType', 'kind', 'detail'],
  elementKeys: ['pageNumber', 'label', 'content'],
};

const PAGE = '{"pageNumber":1,"label":"1","content":"x"}';
const success = (pages: string): string =>
  `{"ok":true,"pages":${pages},"mimeType":"x"}`;

const expectPassed = (json: string, skeleton = RESULT): void => {
  expect(() => rejectUnsafeStructure(json, skeleton)).not.toThrow();
};
const expectRefused = (json: string, skeleton = RESULT): void => {
  expect(() => rejectUnsafeStructure(json, skeleton)).toThrow(
    WireProtocolError,
  );
};

describe('rejectUnsafeStructure passes every shape a valid result takes', () => {
  it.each([
    ['a failure', '{"ok":false,"kind":"internal","detail":"d"}'],
    ['one page', success(`[${PAGE}]`)],
    [
      'a page without number and label and with empty content',
      success('[{"pageNumber":null,"label":null,"content":""}]'),
    ],
    ['10,000 pages', success(`[${Array(10_000).fill(PAGE).join(',')}]`)],
    // Refused later for having no page; nothing in it costs memory.
    ['an empty pages array', success('[]')],
    [
      'indented text',
      JSON.stringify(
        {
          ok: true,
          pages: [{ pageNumber: 1, label: null, content: 'x' }],
          mimeType: 'x',
        },
        null,
        2,
      ),
    ],
    [
      'content that looks like structure',
      success(
        `[${JSON.stringify({
          pageNumber: 1,
          label: '[{"a":[1,2]}]',
          content: `{"pageNumber":[[{}]]}\\"${'\n'.repeat(1000)}`,
        })}]`,
      ),
    ],
  ])('%s', (_id, json) => {
    expectPassed(json);
  });
});

describe('rejectUnsafeStructure refuses what JSON.parse would spend memory on', () => {
  it.each([
    ['empty objects in the array', success('[{},{},{}]')],
    ['arrays in the array', success('[[],[],[]]')],
    ['numbers in the array', success('[1,1,1]')],
    ['strings in the array', success('["",""]')],
    ['literals in the array', success('[null,true]')],
    ['a top-level array of arrays', '[[],[],[]]'],
    ['a top-level array of objects', `[${PAGE}]`],
    [
      'an element that lacks a key',
      success(`[${PAGE},{"pageNumber":1,"label":"1"}]`),
    ],
    [
      'an element with a key of its own',
      success('[{"pageNumber":1,"label":"1","content":"x","a":1}]'),
    ],
    [
      'a top-level key of its own',
      '{"ok":false,"kind":"x","detail":"d","a":1}',
    ],
    ['an object as a top-level value', '{"ok":false,"kind":{},"detail":"d"}'],
    [
      'an array inside an element',
      success('[{"pageNumber":1,"label":[],"content":"x"}]'),
    ],
    [
      'an object inside an element',
      success('[{"pageNumber":1,"label":{},"content":"x"}]'),
    ],
    ['a second array level', success('[[{}]]')],
    ['a duplicate key', '{"ok":false,"ok":false,"kind":"x","detail":"d"}'],
    [
      'a duplicate key written with an escape',
      '{"ok":false,"kind":"x","detail":"d","\\u006bind":"y"}',
    ],
    ['an array nesting bomb', `${'['.repeat(1000)}${']'.repeat(1000)}`],
    ['an object nesting bomb', `${'{"ok":'.repeat(1000)}1${'}'.repeat(1000)}`],
    ['an unclosed array of empty objects', `{"pages":[${'{},'.repeat(1000)}`],
  ])('%s', (_id, json) => {
    expectRefused(json);
  });
});

describe('rejectUnsafeStructure takes the allowed keys from the skeleton', () => {
  const two: ResultSkeleton = { topKeys: ['list'], elementKeys: ['a', 'b'] };
  const three: ResultSkeleton = {
    topKeys: ['list'],
    elementKeys: ['a', 'b', 'c'],
  };

  it('passes an element holding exactly the element keys', () => {
    expectPassed('{"list":[{"a":1,"b":2}]}', two);
    expectPassed('{"list":[{"c":0,"a":1,"b":2}]}', three);
  });

  it('refuses an element one key short', () => {
    expectRefused('{"list":[{"a":1,"b":2}]}', three);
  });

  it('refuses an element one key over', () => {
    expectRefused('{"list":[{"c":0,"a":1,"b":2}]}', two);
  });

  it('refuses a top-level key that the skeleton does not name', () => {
    expectRefused('{"list":[],"other":1}', two);
  });
});
