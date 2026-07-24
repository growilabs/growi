// @vitest-environment happy-dom

import { generateMxgraphData } from '@growi/remark-drawio';

import { extractDrawioData } from './extract-drawio-data';

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

// The save side (extractDrawioData, apps/app) and the render side
// (generateMxgraphData, @growi/remark-drawio) agree on the persisted multi-page
// format only by convention — there is no shared constant. This locks that
// contract across the package boundary: a change to the save wrapper shape or
// the render detection that breaks the other half fails here (see #11522
// review). The single-page render path is covered by embed.spec.ts.
describe('draw.io multi-page save ↔ render round-trip', () => {
  it('a multi-page diagram persisted on save renders every page with navigation enabled', () => {
    const editorMxfile = [
      '<mxfile host="app.diagrams.net">',
      '<diagram id="a" name="Page-1">ENCODED_1</diagram>',
      '<diagram id="b" name="Page-2">ENCODED_2</diagram>',
      '</mxfile>',
    ].join('');

    // save side
    const persisted = extractDrawioData(editorMxfile);
    // render side
    const rendered = decodeMxgraphData(generateMxgraphData(persisted, false));

    // the render side recognizes the persisted format and passes it through
    // untouched, so both pages reach the viewer and it exposes page navigation
    expect(rendered.xml).toBe(persisted);
    expect(rendered.xml).toContain('name="Page-1"');
    expect(rendered.xml).toContain('name="Page-2"');
    expect(rendered.nav).toBe(true);
    expect(rendered.toolbar).toBe('pages');
  });
});
