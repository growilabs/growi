// @vitest-environment happy-dom

import { extractDrawioData } from './extract-drawio-data';

describe('extractDrawioData', () => {
  describe('single-page diagram (backward compatibility)', () => {
    it('returns the first diagram inner content unchanged', () => {
      const mxfile =
        '<mxfile host="app.diagrams.net"><diagram id="a" name="Page-1">ENCODED_CONTENT_1</diagram></mxfile>';

      const result = extractDrawioData(mxfile);

      // The single-page representation must stay byte-identical to the previous
      // behavior so existing pages serialize to the same markdown (no churn).
      expect(result).toBe('ENCODED_CONTENT_1');
    });
  });

  describe('multi-page diagram (#11522 — must not drop pages)', () => {
    const mxfile = [
      '<mxfile host="app.diagrams.net">',
      '<diagram id="a" name="Page-1">ENCODED_CONTENT_1</diagram>',
      '<diagram id="b" name="Page-2">ENCODED_CONTENT_2</diagram>',
      '<diagram id="c" name="Page-3">ENCODED_CONTENT_3</diagram>',
      '</mxfile>',
    ].join('');

    it('preserves every page (content and name), not only the first', () => {
      const result = extractDrawioData(mxfile);

      // Parse the persisted string back: the contract is "no page is lost",
      // not any particular serialization/whitespace.
      const dom = new DOMParser().parseFromString(result, 'text/xml');
      const diagrams = Array.from(dom.getElementsByTagName('diagram'));

      expect(diagrams).toHaveLength(3);
      expect(diagrams.map((d) => d.getAttribute('name'))).toEqual([
        'Page-1',
        'Page-2',
        'Page-3',
      ]);
      expect(diagrams.map((d) => d.innerHTML)).toEqual([
        'ENCODED_CONTENT_1',
        'ENCODED_CONTENT_2',
        'ENCODED_CONTENT_3',
      ]);
    });

    it('persists a self-contained <mxfile> so reopening restores every page', () => {
      const result = extractDrawioData(mxfile).trim();

      expect(result.startsWith('<mxfile')).toBe(true);
      expect(result.endsWith('</mxfile>')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns an empty string when no diagram element is present', () => {
      expect(extractDrawioData('<mxfile></mxfile>')).toBe('');
    });
  });
});
