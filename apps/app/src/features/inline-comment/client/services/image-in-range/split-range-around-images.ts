/**
 * A Range taken apart at every image it contains.
 *
 * - `textRanges`: the original Range with each image cut out, in document
 *   order. These are what a `::highlight()` should paint.
 * - `images`: the images that were cut out. These get an outline instead of
 *   the highlight color (see `markImages`).
 */
export interface RangeSplitAroundImages {
  readonly textRanges: readonly Range[];
  readonly images: readonly HTMLImageElement[];
}

/**
 * Chrome paints a `::highlight()` background ON TOP of an image inside the
 * highlighted Range, so an opaque highlight color hides the image entirely.
 * Painting only the text around the images keeps them visible.
 *
 * The input Range is never modified; every returned Range is a new object.
 * A Range with no image in it comes back as a single equivalent Range.
 */
export const splitRangeAroundImages = (
  range: Range,
): RangeSplitAroundImages => {
  const images = imagesInside(range);

  const textRanges: Range[] = [];
  let rest = range.cloneRange();
  for (const image of images) {
    const before = rest.cloneRange();
    before.setEndBefore(image);
    if (!before.collapsed) {
      textRanges.push(before);
    }
    rest = range.cloneRange();
    rest.setStartAfter(image);
  }
  if (!rest.collapsed) {
    textRanges.push(rest);
  }

  return { textRanges, images };
};

const imagesInside = (range: Range): HTMLImageElement[] => {
  const ancestor = range.commonAncestorContainer;
  const root = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  if (root == null) {
    return [];
  }
  // querySelectorAll returns elements in document order, which the
  // splitting loop above relies on.
  return Array.from(root.querySelectorAll('img')).filter((image) =>
    range.intersectsNode(image),
  );
};
