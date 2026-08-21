import { drawioConfig } from './drawio-config';

type Rule = { selectors: string[]; properties: string[] };

const parseRules = (css: string): Rule[] =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map(([, head, body]) => ({
    selectors: head
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    properties: body
      .split(';')
      .map((decl) => decl.split(':')[0]?.trim())
      .filter((p): p is string => p != null && p.length > 0),
  }));

const selectorsDeclaring = (css: string, property: string): string[] =>
  parseRules(css)
    .filter((rule) => rule.properties.includes(property))
    .flatMap((rule) => rule.selectors);

describe('drawioConfig.css', () => {
  // draw.io v26 removed styles/atlas.css, which was the only thing giving the menubar
  // light text. Overriding a background without also setting the foreground therefore
  // leaves the menu labels at draw.io's dark default and unreadable (see #10478).
  it('should declare a foreground colour for every surface it repaints', () => {
    const painted = selectorsDeclaring(drawioConfig.css, 'background-color');
    const coloured = selectorsDeclaring(drawioConfig.css, 'color');

    expect(painted.length).toBeGreaterThan(0);
    expect(coloured).toEqual(expect.arrayContaining(painted));
  });

  it('should colour the menubar entries themselves, not only their container', () => {
    // The entries are anchors; draw.io <= v25 coloured them with an explicit rule of its
    // own, so relying on inheritance from the container alone is not enough.
    expect(selectorsDeclaring(drawioConfig.css, 'color')).toContain(
      '.geMenubar .geItem',
    );
  });

  it('should leave the editor buttons alone so draw.io keeps styling them', () => {
    // A blanket ".geMenubarContainer *" would also hit Save/Exit, which draw.io renders
    // as dark text on a light button.
    for (const selector of selectorsDeclaring(drawioConfig.css, 'color')) {
      expect(selector).not.toMatch(/\*/);
    }
  });
});
