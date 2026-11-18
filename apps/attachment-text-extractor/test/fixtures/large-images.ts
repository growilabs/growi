import { buildDocx } from './docx';
import { buildGrayPng } from './png';
import { buildPptx } from './pptx';
import { createRandomBytes } from './seeded-random';

// Documents of incompressible images (tests/fixture_files.py's
// `_random_images`): 11 x 4 MiB is over 40 MiB and under the 50 MiB upload
// limit; 12 images make the 48 MiB DOCX of Req 11.2's RSS baseline.

const IMAGE_SIDE = 2048;
const LARGE_IMAGE_COUNT = 11;
// No compression, so the random pixels keep the PNGs at full size.
const STORED = 0;

/** Grayscale PNGs of random pixels drawn from one seeded stream. */
export const randomGrayPngs = (
  count: number,
  side: number,
  seed: number,
): Buffer[] => {
  const randomBytes = createRandomBytes(seed);
  return Array.from({ length: count }, () =>
    buildGrayPng(side, randomBytes(side * side), STORED),
  );
};

export const buildLargeImagesDocx = (): Buffer =>
  buildDocx(
    ['large docx with images'],
    randomGrayPngs(LARGE_IMAGE_COUNT, IMAGE_SIDE, 40),
  );

/** A titled slide, then one picture per slide, as Python's `make_pptx` lays it out. */
export const buildLargeImagesPptx = (): Buffer =>
  buildPptx([
    { title: 'large pptx with images', body: 'slide with images follows' },
    ...randomGrayPngs(LARGE_IMAGE_COUNT, IMAGE_SIDE, 41).map((image) => ({
      pictures: [{ image }],
    })),
  ]);

export const buildTwelveImagesDocx = (): Buffer =>
  buildDocx(['docx with twelve images'], randomGrayPngs(12, IMAGE_SIDE, 48));
