import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

import { ConversionError } from '../conversion-error';

export type Pdfium = WrappedPdfiumModule;

const instantiate = async (): Promise<Pdfium> => {
  // Imported here so a child converting anything but a PDF never loads the
  // WASM (research.md 20.1).
  const { init } = await import('@embedpdf/pdfium');
  const wasmPath = createRequire(import.meta.url).resolve(
    '@embedpdf/pdfium/pdfium.wasm',
  );
  // Always pass the binary, so the loader never looks for it anywhere else.
  const wasmBinary = new Uint8Array(await readFile(wasmPath)).buffer;
  const pdfium = await init({ wasmBinary });
  pdfium.PDFiumExt_Init();
  return pdfium;
};

let instance: Promise<Pdfium> | null = null;

export const loadPdfium = (): Promise<Pdfium> => {
  instance ??= instantiate();
  return instance;
};

/** After an abort or a heap overrun the instance cannot be trusted again. */
export const discardPdfium = (): void => {
  instance = null;
};

// The embedded malloc returns 0 instead of throwing when WASM memory cannot
// grow; writing through address 0 would corrupt PDFium's own state (research.md 14.8).
export const allocate = (pdfium: Pdfium, size: number): number => {
  const pointer = pdfium.pdfium.wasmExports.malloc(size);
  if (pointer === 0) {
    throw new ConversionError('internal', 'PDFium could not allocate memory');
  }
  return pointer;
};

export const release = (pdfium: Pdfium, pointer: number): void => {
  pdfium.pdfium.wasmExports.free(pointer);
};
