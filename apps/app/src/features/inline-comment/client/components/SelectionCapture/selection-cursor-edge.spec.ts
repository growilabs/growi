// @vitest-environment happy-dom

import { cursorEdgeOf } from './selection-cursor-edge';

const mountParagraphs = (...texts: string[]): Text[] => {
  const container = document.createElement('div');
  const nodes = texts.map((text) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    container.appendChild(paragraph);
    return paragraph.firstChild as Text;
  });
  document.body.appendChild(container);
  return nodes;
};

describe('cursorEdgeOf', () => {
  it('is "end" for a left-to-right drag within one text node', () => {
    const [text] = mountParagraphs('hello world');

    expect(
      cursorEdgeOf({
        anchorNode: text,
        anchorOffset: 0,
        focusNode: text,
        focusOffset: 5,
      }),
    ).toBe('end');
  });

  it('is "start" for a right-to-left drag within one text node', () => {
    const [text] = mountParagraphs('hello world');

    expect(
      cursorEdgeOf({
        anchorNode: text,
        anchorOffset: 5,
        focusNode: text,
        focusOffset: 0,
      }),
    ).toBe('start');
  });

  it('is "end" when the focus is in a later node than the anchor', () => {
    const [first, second] = mountParagraphs('first', 'second');

    expect(
      cursorEdgeOf({
        anchorNode: first,
        anchorOffset: 1,
        focusNode: second,
        focusOffset: 3,
      }),
    ).toBe('end');
  });

  it('is "start" when the focus is in an earlier node than the anchor', () => {
    const [first, second] = mountParagraphs('first', 'second');

    expect(
      cursorEdgeOf({
        anchorNode: second,
        anchorOffset: 3,
        focusNode: first,
        focusOffset: 1,
      }),
    ).toBe('start');
  });

  it('defaults to "end" when the selection has no anchor or focus node', () => {
    expect(
      cursorEdgeOf({
        anchorNode: null,
        anchorOffset: 0,
        focusNode: null,
        focusOffset: 0,
      }),
    ).toBe('end');
  });
});
