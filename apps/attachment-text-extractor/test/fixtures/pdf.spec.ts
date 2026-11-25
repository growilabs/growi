import { buildImageOnlyPdf, buildTextPdf } from './pdf';
import { anydocErrorCode, anydocMarkdown } from './spec-support';

const xrefOffsets = (pdf: Buffer): number[] => {
  const text = pdf.toString('latin1');
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  const table = text.slice(xrefAt);
  return [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) =>
    Number(match[1]),
  );
};

describe('buildTextPdf', () => {
  it('writes a PDF with the magic header and end marker', () => {
    const pdf = buildTextPdf(['PDF page 1']).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });

  it('writes one page per text, in order, that anydoc extracts', async () => {
    const pdf = buildTextPdf(['PDF page 1', 'PDF page 2', 'PDF page 3']);

    const markdown = await anydocMarkdown(pdf, 'pdf');

    expect(pdf.toString('latin1')).toContain('/Count 3');
    expect(markdown).toMatch(/PDF page 1[\s\S]*PDF page 2[\s\S]*PDF page 3/);
  });

  it('writes a cross-reference table whose offsets point at each object', () => {
    const pdf = buildTextPdf(['first', 'second']);

    const offsets = xrefOffsets(pdf);
    const xrefAt = pdf.toString('latin1').lastIndexOf('\nxref\n') + 1;

    expect(offsets.length).toBeGreaterThan(0);
    offsets.forEach((offset, index) => {
      expect(pdf.toString('latin1', offset, offset + 12)).toMatch(
        new RegExp(`^${index + 1} 0 obj\\n`),
      );
    });
    expect(pdf.toString('latin1')).toContain(`startxref\n${xrefAt}\n`);
  });

  it('refuses text that is not printable ASCII', () => {
    expect(() => buildTextPdf(['日本語'])).toThrow();
  });
});

describe('buildImageOnlyPdf', () => {
  it('writes a page with an image and no text, which anydoc says needs OCR', async () => {
    const pdf = buildImageOnlyPdf();

    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    expect(pdf.toString('latin1')).not.toMatch(/\bBT\b/);
    expect(await anydocErrorCode(pdf, 'pdf')).toBe('needsOcr');
  });
});
