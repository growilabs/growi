// Parameters GROWI controls for the embedded editor.
// refs: https://desk.draw.io/support/solutions/articles/16000042546-what-url-parameters-are-supported-
const growiControlledParams = (lang: string): Record<string, string> => ({
  spin: '1',
  embed: '1',
  lang,
  ui: 'atlas',
  configure: '1',
});

// Throws when drawioUri is not a valid URL; the caller decides how to report that.
export const buildDrawioEditorUrl = (drawioUri: string, lang: string): URL => {
  const url = new URL(drawioUri);

  // set, not append: DRAWIO_URI may already carry these. draw.io builds urlParams by
  // assigning each occurrence in order, so a duplicated key silently resolves to the last
  // one and the value in DRAWIO_URI looks ignored.
  // refs: https://github.com/growilabs/growi/issues/10478
  for (const [key, value] of Object.entries(growiControlledParams(lang))) {
    url.searchParams.set(key, value);
  }

  return url;
};
