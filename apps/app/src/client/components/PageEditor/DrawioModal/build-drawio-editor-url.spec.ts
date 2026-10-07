import { buildDrawioEditorUrl } from './build-drawio-editor-url';

describe('buildDrawioEditorUrl', () => {
  it('should add the parameters the embedded editor needs', () => {
    const url = buildDrawioEditorUrl('http://localhost:8080', 'ja');

    expect(url.origin).toBe('http://localhost:8080');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      spin: '1',
      embed: '1',
      lang: 'ja',
      ui: 'atlas',
      configure: '1',
    });
  });

  it('should keep parameters DRAWIO_URI carries that GROWI does not control', () => {
    const url = buildDrawioEditorUrl(
      'http://localhost:8080/?stealth=1&https=0',
      'ja',
    );

    expect(url.searchParams.get('stealth')).toBe('1');
    expect(url.searchParams.get('https')).toBe('0');
  });

  it('should keep the path when draw.io is deployed under a sub path', () => {
    const url = buildDrawioEditorUrl('http://example.com/drawio', 'en');

    expect(url.pathname).toBe('/drawio');
  });

  // draw.io parses its query into urlParams by assigning each occurrence in order, so a
  // duplicated key silently resolves to the last one. Appending therefore produced
  // "lang=en&lang=ja" and made the value in DRAWIO_URI look broken (see #10478).
  it('should not duplicate a parameter that DRAWIO_URI already sets', () => {
    const url = buildDrawioEditorUrl('http://localhost:8080/?lang=en', 'ja');

    expect(url.searchParams.getAll('lang')).toEqual(['ja']);
  });

  it.each([
    'spin',
    'embed',
    'ui',
    'configure',
  ])('should not duplicate "%s" when DRAWIO_URI already sets it', (key) => {
    const url = buildDrawioEditorUrl(`http://localhost:8080/?${key}=0`, 'ja');

    expect(url.searchParams.getAll(key)).toHaveLength(1);
  });

  it('should throw when drawioUri cannot be parsed', () => {
    expect(() => buildDrawioEditorUrl('not-a-url', 'ja')).toThrow();
  });
});
