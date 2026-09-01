import { describe, expect, it } from 'vitest';

import { generateMxgraphData } from './embed.js';

// The viewer consumes JSON.parse(el.dataset.mxgraph) after the browser decodes
// the HTML entities in the attribute. Mirror that here by reversing embed.ts's
// escaping and parsing, so tests assert the config object the viewer actually
// reads (the contract) instead of the opaque escaped string.
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

describe('generateMxgraphData', () => {
  it('returns an empty string for blank code', () => {
    expect(generateMxgraphData('', false)).toBe('');
    expect(generateMxgraphData('   ', false)).toBe('');
  });

  describe('legacy single-page format (a single diagram inner XML)', () => {
    const code = '<mxGraphModel><root></root></mxGraphModel>';

    it('wraps the code in a single <diagram> and keeps page navigation off', () => {
      const data = decodeMxgraphData(generateMxgraphData(code, false));

      expect(data.xml).toContain(`<diagram>${code}</diagram>`);
      expect(data.nav).toBe(false);
      expect(data.toolbar).toBeNull();
    });
  });

  describe('multi-page format (a full <mxfile>, see #11522)', () => {
    const mxfile = [
      '<mxfile>',
      '<diagram id="a" name="Page-1"><mxGraphModel>AAA</mxGraphModel></diagram>',
      '<diagram id="b" name="Page-2"><mxGraphModel>BBB</mxGraphModel></diagram>',
      '</mxfile>',
    ].join('\n');

    it('passes the mxfile through untouched so every page survives', () => {
      const data = decodeMxgraphData(generateMxgraphData(mxfile, false));

      // No re-wrapping: the stored mxfile is used verbatim and both pages remain.
      expect(data.xml).toBe(mxfile);
      expect(data.xml).toContain('name="Page-1"');
      expect(data.xml).toContain('name="Page-2"');
    });

    it('enables page navigation so the extra pages are reachable', () => {
      const data = decodeMxgraphData(generateMxgraphData(mxfile, false));

      expect(data.nav).toBe(true);
      expect(data.toolbar).toBe('pages');
    });
  });

  describe('dark mode', () => {
    it('sets dark-mode when enabled', () => {
      const data = decodeMxgraphData(
        generateMxgraphData('<mxGraphModel></mxGraphModel>', true),
      );

      expect(data['dark-mode']).toBe('dark');
    });
  });
});
