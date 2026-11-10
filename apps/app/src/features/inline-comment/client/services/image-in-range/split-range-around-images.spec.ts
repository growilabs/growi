// @vitest-environment happy-dom

import { splitRangeAroundImages } from './split-range-around-images';

const containerOf = (html: string): HTMLElement => {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
};

/** A Range from the start of the first text node to the end of the last one. */
const rangeOverWholeText = (container: HTMLElement): Range => {
  const textsIn = (node: Node): Node[] =>
    node.nodeType === Node.TEXT_NODE
      ? [node]
      : Array.from(node.childNodes).flatMap(textsIn);
  const texts = textsIn(container);
  const range = document.createRange();
  range.setStart(texts[0], 0);
  const last = texts[texts.length - 1];
  range.setEnd(last, last.textContent?.length ?? 0);
  return range;
};

describe('splitRangeAroundImages', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the text on both sides of an image as separate ranges, and the image itself', () => {
    const container = containerOf('before <img alt="a"> after');
    const range = rangeOverWholeText(container);

    const { textRanges, images } = splitRangeAroundImages(range);

    expect(textRanges.map((r) => r.toString())).toEqual(['before ', ' after']);
    expect(images).toEqual([container.querySelector('img')]);
  });

  it('cuts out every image, keeping the text pieces in document order', () => {
    const container = containerOf(
      '<ul><li>one <img alt="a"> two</li><li>three <button><img alt="b"></button> four</li></ul>',
    );
    const range = rangeOverWholeText(container);

    const { textRanges, images } = splitRangeAroundImages(range);

    expect(textRanges.map((r) => r.toString())).toEqual([
      'one ',
      ' twothree ',
      ' four',
    ]);
    expect(images.map((i) => i.alt)).toEqual(['a', 'b']);
  });

  it('returns one equivalent range and no images when the range has no image in it', () => {
    const container = containerOf('plain text only');
    const range = rangeOverWholeText(container);

    const { textRanges, images } = splitRangeAroundImages(range);

    expect(textRanges.map((r) => r.toString())).toEqual(['plain text only']);
    expect(images).toEqual([]);
  });

  it('ignores images outside the range', () => {
    const container = containerOf(
      '<p><img alt="outside-before"></p><p>inside</p><p><img alt="outside-after"></p>',
    );
    const text = container.querySelectorAll('p')[1].firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);

    const { textRanges, images } = splitRangeAroundImages(range);

    expect(textRanges.map((r) => r.toString())).toEqual(['inside']);
    expect(images).toEqual([]);
  });

  it('returns no text range when the range holds nothing but an image', () => {
    const container = containerOf('<img alt="only">');
    const range = document.createRange();
    range.selectNode(container.querySelector('img') as HTMLImageElement);

    const { textRanges, images } = splitRangeAroundImages(range);

    expect(textRanges).toEqual([]);
    expect(images.map((i) => i.alt)).toEqual(['only']);
  });

  it('leaves the given range unchanged', () => {
    const container = containerOf('before <img alt="a"> after');
    const range = rangeOverWholeText(container);

    splitRangeAroundImages(range);

    expect(range.toString()).toBe('before  after');
    expect(range.intersectsNode(container.querySelector('img') as Node)).toBe(
      true,
    );
  });
});
