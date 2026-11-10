// @vitest-environment happy-dom

import { imageOutlineSelector, markImages } from './image-highlight-marker';

describe('markImages', () => {
  let image: HTMLImageElement;

  beforeEach(() => {
    image = document.createElement('img');
    document.body.appendChild(image);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('makes the image match its state selector, and stops matching once unmarked', () => {
    const unmark = markImages([image], 'saved');
    expect(image.matches(imageOutlineSelector('saved'))).toBe(true);

    unmark();
    expect(image.matches(imageOutlineSelector('saved'))).toBe(false);
    expect(image.attributes).toHaveLength(0);
  });

  it('keeps the other states when one state is unmarked', () => {
    const unmarkSaved = markImages([image], 'saved');
    const unmarkEmphasis = markImages([image], 'emphasis');

    unmarkEmphasis();

    expect(image.matches(imageOutlineSelector('saved'))).toBe(true);
    expect(image.matches(imageOutlineSelector('emphasis'))).toBe(false);
    unmarkSaved();
  });

  it('marks an image passed twice only once', () => {
    const unmark = markImages([image, image], 'pending');
    unmark();

    expect(image.matches(imageOutlineSelector('pending'))).toBe(false);
  });
});

describe('imageOutlineSelector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    [['saved'], 'saved'],
    [['saved', 'pending'], 'pending'],
    [['saved', 'emphasis'], 'emphasis'],
    [['pending', 'emphasis'], 'emphasis'],
    [['saved', 'pending', 'emphasis'], 'emphasis'],
  ] as const)('an image in states %j is outlined only as %s', (states, winner) => {
    const image = document.createElement('img');
    document.body.appendChild(image);
    for (const state of states) {
      markImages([image], state);
    }

    const matched = (['saved', 'pending', 'emphasis'] as const).filter((s) =>
      image.matches(imageOutlineSelector(s)),
    );

    expect(matched).toEqual([winner]);
  });
});
