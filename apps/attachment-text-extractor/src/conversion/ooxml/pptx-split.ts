import type { ConversionLimits, PageInfo } from '../../contract';
import { convertOffice } from '../office';
import { inspectArchive } from './archive-guard';
import { cleanSlideText } from './pptx-cleanup';
import { PRESENTATION, slidePackages } from './pptx-slide-packages';

/**
 * One element per slide in presentation order. anydoc emits no slide
 * boundaries, so each slide is converted from its own package. A file that
 * fails the ZIP pre-check (legacy PPT, encrypted OOXML) goes to anydoc whole
 * as one unnumbered element.
 */
export const convertPptx = async (
  bytes: Uint8Array,
  limits: ConversionLimits,
): Promise<readonly PageInfo[]> => {
  const archive = await inspectArchive(bytes, PRESENTATION, limits);
  if (archive == null) {
    const content = cleanSlideText(await convertOffice(bytes, 'pptx'));
    return [{ pageNumber: null, label: null, content }];
  }
  try {
    const pages: PageInfo[] = [];
    for await (const slidePackage of slidePackages(archive, limits)) {
      const number = pages.length + 1;
      const content = cleanSlideText(await convertOffice(slidePackage, 'pptx'));
      pages.push({ pageNumber: number, label: String(number), content });
    }
    return pages;
  } finally {
    archive.close();
  }
};
