// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { generateMxgraphData } from './embed.js';
import { extractDrawioData, isMxfileData } from './mxfile.js';

// Reverse embed.ts's escapeHTML + JSON.stringify to inspect the config object
// the viewer actually consumes.
const decodeMxgraphData = (escaped: string) => {
  const json = escaped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x60;/g, '`')
    .replace(/&amp;/g, '&');
  return JSON.parse(json);
};

describe('extractDrawioData', () => {
  describe('single-page diagram (backward compatibility)', () => {
    it('returns the first diagram inner content unchanged', () => {
      const mxfile =
        '<mxfile host="app.diagrams.net"><diagram id="a" name="Page-1">ENCODED_CONTENT_1</diagram></mxfile>';

      // Must stay byte-identical to the previous behavior so existing pages
      // serialize to the same markdown (no churn).
      expect(extractDrawioData(mxfile)).toBe('ENCODED_CONTENT_1');
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

      // Parse the persisted string back: the contract is "no page is lost".
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

    it('persists an <mxfile> that isMxfileData recognizes (round-trip contract)', () => {
      const result = extractDrawioData(mxfile);

      // The persisted format must be detected by the render side's predicate.
      expect(isMxfileData(result)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns an empty string when no diagram element is present', () => {
      expect(extractDrawioData('<mxfile></mxfile>')).toBe('');
    });
  });
});

// The save side (extractDrawioData) and the render side (generateMxgraphData)
// agree on the persisted multi-page format. This end-to-end test locks that
// contract so a change to either half that breaks the other fails here.
describe('save ↔ render round-trip', () => {
  it('a multi-page diagram persisted on save renders every page with navigation enabled', () => {
    const editorMxfile = [
      '<mxfile host="app.diagrams.net">',
      '<diagram id="a" name="Page-1">ENCODED_1</diagram>',
      '<diagram id="b" name="Page-2">ENCODED_2</diagram>',
      '</mxfile>',
    ].join('');

    const persisted = extractDrawioData(editorMxfile);
    const rendered = decodeMxgraphData(generateMxgraphData(persisted, false));

    // recognized as multi-page and passed through untouched
    expect(rendered.xml).toBe(persisted);
    expect(rendered.xml).toContain('name="Page-1"');
    expect(rendered.xml).toContain('name="Page-2"');
    expect(rendered.nav).toBe(true);
    expect(rendered.toolbar).toBe('pages');
  });
});

describe('isMxfileData', () => {
  it('detects the multi-page <mxfile> format, tolerating leading whitespace', () => {
    expect(isMxfileData('<mxfile><diagram/></mxfile>')).toBe(true);
    expect(isMxfileData('  \n<mxfile >')).toBe(true);
  });

  it('rejects legacy single-diagram inner content', () => {
    expect(isMxfileData('<mxGraphModel>x</mxGraphModel>')).toBe(false);
    expect(isMxfileData('7Vpbc9o4FP41PLbjC7d9DJC0zLbdTNlOp08dYQvQ')).toBe(
      false,
    );
    // anchored [\s>] rejects a longer tag name
    expect(isMxfileData('<mxfileFoo>')).toBe(false);
  });
});
